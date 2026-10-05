# RAG hoạt động như thế nào: các tầng, cách lưu trữ và cách truy xuất

Tài liệu học, bám theo code thật của dự án `rag-assistant`. Mỗi phần có: **khái niệm**, **code nằm ở đâu**, **những điểm cần chú ý**.

Các khối 📄 là code trích từ `backend/`. Phần xử lý lỗi và log được lược bớt (đánh dấu `...`) cho dễ đọc; các dòng có `# ←` là chú thích tao thêm vào, không có trong file gốc.

---

## 0. RAG là gì, tại sao cần?

LLM (ví dụ Qwen) chỉ biết những gì nó được huấn luyện. Nó **không biết** nội dung file PDF nội bộ của bạn, và khi không biết thì nó hay **bịa** (hallucination).

**RAG = Retrieval-Augmented Generation** = "Tìm trước, trả lời sau":

1. **Retrieval** – tìm vài đoạn văn trong tài liệu liên quan nhất tới câu hỏi.
2. **Augmented** – nhét các đoạn đó vào prompt làm "NGỮ CẢNH".
3. **Generation** – LLM đọc ngữ cảnh rồi trả lời, kèm trích dẫn `[1]`, `[2]`.

> Ví von: LLM là sinh viên đi thi. Không có RAG là thi đóng sách. Có RAG là thi **mở sách**, nhưng chỉ được mang vào **5 trang** mà người khác (retriever) chọn sẵn. Retriever chọn sai trang thì sinh viên giỏi cỡ nào cũng trả lời sai.

→ Chất lượng RAG phụ thuộc **rất lớn vào khâu truy xuất**, không chỉ vào LLM.

---

## 1. Bức tranh tổng thể: hai luồng

RAG luôn có **2 luồng tách biệt**:

```
═══════════════ LUỒNG A: NẠP TÀI LIỆU (Indexing, làm 1 lần / mỗi file) ═══════════════

 file PDF/DOCX/TXT/MD
        │
        ▼
 [1] Loader ─────── trích chữ theo từng trang (+ xuất ảnh, OCR)       ingest/loaders.py, images.py
        │
        ▼
 [2] Cleaning ───── bỏ header/footer, số trang, nối dòng bị ngắt     ingest/cleaning.py
        │
        ▼
 [3] Chunking ───── cắt thành đoạn ~500 token, chồng lấn 50           ingest/chunker.py
        │
        ▼
 [4] Embedding ──── mỗi đoạn → 1 vector 384 chiều ("passage: ...")    ingest/embedder.py
        │
        ▼
 [5] Lưu trữ ────── SQLite: text + vector + số trang + ảnh            db.py
                    FAISS & BM25: dựng lại trong RAM từ SQLite        retrieval/faiss_index.py, bm25.py


═══════════════ LUỒNG B: HỎI ĐÁP (Query, mỗi câu hỏi) ═══════════════

 câu hỏi + lịch sử chat
        │
        ▼
 [6] Query rewrite ─ "nó giá bao nhiêu?" → "Gói Premium giá bao nhiêu?"  llm/rewrite.py
        │
        ▼
 [7] Embed câu hỏi ─ vector 384 chiều ("query: ...")                    ingest/embedder.py
        │
        ▼
 [8] Dense search ── FAISS lấy 20 đoạn gần nhất, lọc cosine ≥ 0.795     retrieval/faiss_index.py
        │
        ▼
 [9] Rerank ──────── RRF trộn thứ hạng dense + thứ hạng BM25 → top 5    retrieval/hybrid.py
        │
        ▼
 [10] Prompt ─────── SYSTEM_PROMPT + "[1] (Nguồn: x.pdf, trang 3) ..."   llm/prompts.py
        │
        ▼
 [11] LLM ────────── Qwen3-4B sinh từng token, stream qua SSE           llm/client.py, api/chat.py
        │
        ▼
 [12] Lưu lịch sử ── bảng messages + feedback                           db.py
```

**Quy tắc vàng:** tài liệu và câu hỏi phải đi qua **cùng một mô hình embedding**. Nếu đổi mô hình, vector cũ và mới sẽ "nói hai ngôn ngữ khác nhau" và bạn phải nạp lại toàn bộ (README cũng nhắc: đổi `EMBEDDING_MODEL` hoặc `CHUNK_*` thì xoá `storage/` rồi nạp lại).

---

## 2. Luồng A: nạp tài liệu, từng tầng một

Toàn bộ luồng được điều phối trong `ingest/pipeline.py` → hàm `ingest_document()`, chạy trong thread nền và cập nhật `progress` (%) vào bảng `documents`:

| % | stage | Việc đang làm |
|---|---|---|
| 5 | extracting | Đọc chữ |
| 10 | images | Xuất ảnh / OCR |
| 15 | cleaning | Làm sạch |
| 20 | loading_model | Nạp mô hình embedding |
| 25 | chunking | Cắt đoạn |
| 30 → 90 | embedding | Tạo vector theo batch |
| 92 | storing | Ghi SQLite |
| 100 | done | Xong, xoá cache chỉ mục |

📄 **Khung của `ingest_document()`** (`ingest/pipeline.py`), đã lược phần ảnh và xử lý lỗi:

```python
def ingest_document(doc_id: str, path: Path, filename: str, file_type: str) -> None:
    """Chạy trong thread nền. Cập nhật tiến trình vào bảng documents."""
    s = get_settings()

    _progress(doc_id, 5, "extracting")
    pages = extract_pages(path, file_type, ...)                          # ← Tầng 1

    _progress(doc_id, 15, "cleaning")
    pages = clean_pages(pages, file_type, strip_boilerplate=s.document_strip_boilerplate)  # ← Tầng 2

    _progress(doc_id, 20, "loading_model")
    embedder = get_embedder()

    _progress(doc_id, 25, "chunking")
    chunks = chunk_pages(                                                 # ← Tầng 3
        pages,
        embedder.tokenizer,          # ← đếm token bằng CHÍNH tokenizer của mô hình embedding
        s.chunk_size,
        s.chunk_overlap,
        min_chunk_size=s.min_chunk_size,
        strategy=s.chunking_strategy,
    )

    def on_embed(done: int, total: int) -> None:
        _progress(doc_id, 30 + int(60 * done / total), "embedding")      # ← 30% → 90%

    vectors = embedder.embed_documents([c.text for c in chunks], on_progress=on_embed)  # ← Tầng 4

    _progress(doc_id, 92, "storing")
    db.insert_chunks([...])                                               # ← Tầng 5 (xem mục 3.1)

    db.update_document(doc_id, status="ready", progress=100, stage="done", ...)
    invalidate_faiss()                                                    # ← xoá cache, lần hỏi sau dựng lại
    invalidate_bm25()
```

### Tầng 1: Loader, trích xuất văn bản (`ingest/loaders.py`)

**Mục tiêu:** từ file nhị phân lấy ra `list[Page(number, text)]`. **Giữ số trang** vì sau này cần trích dẫn "trang 3".

- **PDF**: `pypdf` đọc từng trang bằng `page.extract_text()`. Một trang lỗi thì trả chuỗi rỗng, không làm hỏng cả file.
- **DOCX**: Word **không có khái niệm trang cố định**, nên code *ước lượng* trang dựa trên ngắt trang thủ công (`w:br type=page`) và dấu `lastRenderedPageBreak` mà Word lưu lại. Bảng được chuyển thành dòng `ô1 | ô2 | ô3`.
- **TXT/MD**: cả file là 1 trang. Thử lần lượt các encoding `utf-8-sig → utf-16 → cp1258 → cp1252`.
- **PDF scan** (toàn ảnh): không có chữ, nên báo lỗi, trừ khi bật `DOCUMENT_IMAGE_OCR=true` (khi đó Tesseract đọc chữ trong ảnh rồi ghép vào trang tương ứng, xem `pipeline.py`).

📄 **Code** (`ingest/loaders.py`):

```python
@dataclass
class Page:
    number: int      # ← số trang, sau này dùng để trích dẫn "trang 3"
    text: str


def extract_pages(path: Path, file_type: str, require_text: bool = True) -> list[Page]:
    if file_type == "pdf":
        pages = _extract_pdf(path)
    elif file_type == "docx":
        pages = _extract_docx(path)
    elif file_type in ("txt", "md"):
        pages = [Page(1, _read_text(path))]          # ← TXT/MD: cả file = 1 trang
    else:
        raise ExtractionError(f"Định dạng '{file_type}' không được hỗ trợ.")

    if require_text:
        ensure_has_text(pages, file_type)            # ← không có chữ → báo "có thể là bản scan"
    return pages


def _extract_pdf(path: Path) -> list[Page]:
    reader = PdfReader(str(path))
    if reader.is_encrypted:
        reader.decrypt("")                           # ← thử mở PDF khoá bằng mật khẩu rỗng
    pages: list[Page] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:                            # ← một trang lỗi không làm hỏng cả file
            text = ""
        pages.append(Page(i, text))
    return pages
```

DOCX: duyệt từng phần tử trong thân văn bản, gặp dấu ngắt trang thì sang trang mới:

```python
    for block in document.element.body.iterchildren():
        tag = block.tag
        if tag == f"{W}p":                                   # ← đoạn văn
            if has_page_break(block) and buffer:
                flush()                                      # ← đóng trang hiện tại
                page_no += 1
            text = para_text(block).strip()
            if text:
                buffer.append(text)
        elif tag == f"{W}tbl":                               # ← bảng → "ô1 | ô2 | ô3"
            rows = []
            for tr in block.iter(f"{W}tr"):
                cells = [" ".join(para_text(p).strip() for p in tc.iter(f"{W}p")).strip()
                         for tc in tr.iter(f"{W}tc")]
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                buffer.append("\n".join(rows))
```

Ảnh trong PDF (`ingest/images.py`) được lưu thành file PNG có tên chứa số trang, nhờ vậy giao diện hiển thị được ảnh của đúng trang nguồn:

```python
    for page_no, page in enumerate(reader.pages, start=1):
        for img_file in page.images:
            img = img_file.image
            w, h = img.size
            if w < min_side or h < min_side:                 # ← bỏ icon/ảnh vụn < 32px
                continue
            filename = f"{doc_id}_p{page_no}_{image_id[:8]}.png"
            img.save(out_dir / filename, format="PNG")
            exported.append(ExportedImage(image_id, page_no, filename, w, h, _ocr(img) if ocr else None))
```

> 💡 **Bài học:** "Rác vào, rác ra". Loader trích sai (mất bảng, đảo thứ tự cột) thì các tầng sau có tốt mấy cũng vô ích.

### Tầng 2: Cleaning, làm sạch (`ingest/cleaning.py`)

PDF trích ra thường rất bẩn. Ba việc chính:

1. **Chuẩn hoá Unicode NFC.** Rất quan trọng với tiếng Việt: chữ "ệ" có thể được lưu thành 1 ký tự *hoặc* "e" + 2 dấu tổ hợp. Nhìn giống nhau nhưng máy coi là khác, nên BM25 sẽ không khớp từ khoá.
2. **Bỏ header/footer lặp lại** (`_find_repeated_edges`). Xét 2 dòng đầu và 2 dòng cuối mỗi trang; dòng nào (sau khi thay số bằng `#`) xuất hiện ở ≥ 50% số trang thì là header/footer, bỏ đi. Số trang kiểu `Trang 3/10`, `- 5 -` bị regex `_PAGE_NUMBER_RE` loại.
   - Vì sao? Nếu không bỏ, chuỗi "CÔNG TY ABC – TÀI LIỆU NỘI BỘ" có mặt trong *mọi* chunk, làm nhiễu embedding và BM25.
3. **Reflow dòng PDF** (`_reflow_pdf_lines`). PDF ngắt dòng theo bề ngang trang, không theo câu. Code nối các dòng cùng đoạn văn lại, nối từ bị gạch nối cuối dòng (`infor-` + `mation` → `information`), và giữ ranh giới khi gặp gạch đầu dòng hoặc câu mới.
   - Vì sao? Để tầng Chunking cắt đúng ranh giới câu/đoạn *thật*.

📄 **Code** (`ingest/cleaning.py`), hàm chính:

```python
def clean_pages(pages: list[Page], file_type: str, strip_boilerplate: bool = True) -> list[Page]:
    pages_lines = [_basic_normalize(p.text).split("\n") for p in pages]   # ← (1) NFC, bỏ ký tự điều khiển
    strip = strip_boilerplate and file_type == "pdf"
    repeated = _find_repeated_edges(pages_lines) if strip else set()      # ← (2) tìm header/footer

    cleaned: list[Page] = []
    for page, lines in zip(pages, pages_lines):
        if file_type == "pdf":
            if strip:
                lines = _strip_edges(lines, repeated)                     # ← (2) cắt header/footer, số trang
            text = _reflow_pdf_lines(lines)                               # ← (3) nối dòng thành đoạn văn
        else:
            text = "\n".join(lines)
        text = _collapse_whitespace(text)
        if text:
            cleaned.append(Page(page.number, text))                       # ← vẫn giữ số trang gốc
    return cleaned
```

(1) Chuẩn hoá Unicode:

```python
def _basic_normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text)  # quan trọng với tiếng Việt (dấu tổ hợp)
    text = text.replace(" ", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)           # ← bỏ ký tự vô hình (zero-width, BOM...)
    return text
```

(2) Tìm header/footer: đếm những dòng hay lặp lại ở mép trang:

```python
_EDGE_LINES = 2        # Số dòng đầu/cuối mỗi trang được xem là vùng header/footer
_MAX_EDGE_LEN = 100    # Dòng dài hơn ngưỡng này không bị coi là header/footer

def _normalize_for_compare(line: str) -> str:
    line = line.lower()
    line = re.sub(r"\d+", "#", line)            # ← "Trang 3" và "Trang 4" đều thành "trang #"
    return re.sub(r"\s+", " ", line).strip()

def _find_repeated_edges(pages_lines: list[list[str]]) -> set[str]:
    n = len(pages_lines)
    if n < 3:
        return set()                              # ← ít trang quá thì không đoán
    counter: Counter[str] = Counter()
    for lines in pages_lines:
        edges = lines[:_EDGE_LINES] + lines[-_EDGE_LINES:]
        counter.update({_normalize_for_compare(l) for l in edges if 0 < len(l.strip()) <= _MAX_EDGE_LEN})
    threshold = max(2, int(n * 0.5))              # ← lặp ở ≥ 50% số trang
    return {line for line, c in counter.items() if c >= threshold and line}
```

(3) Nối dòng PDF:

```python
def _reflow_pdf_lines(lines: list[str]) -> str:
    paragraphs: list[str] = []
    current = ""
    for raw in lines:
        line = raw.strip()
        if not line:                                       # ← dòng trống = hết đoạn
            if current:
                paragraphs.append(current)
                current = ""
            continue
        if not current:
            current = line
        elif _LIST_START_RE.match(line):                   # ← "- ", "1.", "a)" → mục mới
            paragraphs.append(current)
            current = line
        elif current.endswith("-") and len(current) > 1 and current[-2].isalpha():
            current = current[:-1] + line                  # ← "infor-" + "mation" → "information"
        elif _SENTENCE_END_RE.search(current) and line[:1].isupper():
            current += "\n" + line                         # ← hết câu + chữ hoa: giữ ngắt dòng
        else:
            current += " " + line                          # ← còn lại: cùng câu, nối bằng dấu cách
    if current:
        paragraphs.append(current)
    return "\n\n".join(paragraphs)
```

### Tầng 3: Chunking, cắt đoạn (`ingest/chunker.py`)

**Tại sao phải cắt?**
- Mô hình embedding e5 chỉ nhận tối đa **512 token**; dài hơn thì bị cắt mất.
- Một vector cho cả cuốn sách sẽ là "trung bình" của mọi chủ đề, nên không khớp với câu hỏi cụ thể nào.
- Prompt của LLM có giới hạn; chỉ nên nhét vào những phần liên quan.

**Tham số (đơn vị là token, đếm bằng chính tokenizer của e5):**

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `CHUNK_SIZE` | 500 | Độ dài tối đa 1 đoạn |
| `CHUNK_OVERLAP` | 50 | Hai đoạn liền nhau chia sẻ 50 token, để câu nằm vắt ngang ranh giới không bị "cắt đôi nghĩa" |
| `MIN_CHUNK_SIZE` | 50 | Đoạn ngắn hơn thì gộp vào đoạn bên cạnh |
| `CHUNKING_STRATEGY` | recursive | `recursive` hoặc `fixed` |

**Hai chiến lược:**

- **`fixed`**: cửa sổ trượt cứng 500 token. Đơn giản nhưng hay cắt giữa câu.
- **`recursive`** (mặc định): thử cắt theo thứ tự ưu tiên
  ```
  "\n\n" (đoạn văn) → "\n" (dòng) → ". " "? " "! " (câu) → "; " ": " ", " (mệnh đề) → " " (từ) → "" (ký tự)
  ```
  Nghĩa là nó cố giữ nguyên đoạn văn; đoạn văn quá dài thì mới cắt theo câu; câu quá dài mới cắt theo dấu phẩy...

**Mẹo giữ số trang:** các trang được nối thành 1 chuỗi dài (`full_text`), và code ghi lại vị trí ký tự bắt đầu mỗi trang (`starts`). Với mỗi chunk, tìm vị trí của nó trong chuỗi rồi dùng `bisect` tra ngược ra trang bắt đầu (`page`) và trang kết thúc (`page_end`). Nhờ vậy một chunk vắt qua 2 trang sẽ hiển thị "trang 3–4".

**Gộp đoạn nhỏ:** mẩu tiêu đề kiểu "Chương 2" đứng một mình thì embedding rất kém nghĩa, nên được gộp vào đoạn kế bên nếu tổng vẫn ≤ `CHUNK_SIZE`.

📄 **Code** (`ingest/chunker.py`)

Bộ cắt (dùng LangChain, đếm độ dài bằng tokenizer HuggingFace của e5):

```python
SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "… ", "; ", ": ", ", ", " ", ""]   # ← thứ tự ưu tiên

def _splitter(strategy: str, tokenizer, chunk_size: int, chunk_overlap: int):
    if strategy == "fixed":
        return _FixedTokenSplitter(tokenizer, chunk_size, chunk_overlap)
    return RecursiveCharacterTextSplitter.from_huggingface_tokenizer(
        tokenizer,                       # ← đo độ dài bằng TOKEN, không phải ký tự
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=SEPARATORS,
        keep_separator="end",            # ← dấu "." ở cuối câu nằm lại trong chunk trước
        strip_whitespace=True,
    )
```

Bước 1: ghép các trang và ghi lại vị trí bắt đầu từng trang:

```python
    starts: list[int] = []     # vị trí ký tự bắt đầu mỗi trang trong full_text
    numbers: list[int] = []    # số trang tương ứng
    offset = 0
    for page in pages:
        starts.append(offset)
        numbers.append(page.number)
        offset += len(page.text) + len(PAGE_JOINER)
    full_text = PAGE_JOINER.join(p.text for p in pages)

    def page_at(pos: int) -> int:
        return numbers[max(0, bisect_right(starts, pos) - 1)]   # ← tìm nhị phân: vị trí pos thuộc trang nào
```

Ví dụ: trang 1 dài 1000 ký tự, trang 2 dài 800 ký tự → `starts = [0, 1002]`. Chunk bắt đầu ở ký tự 950 và kết thúc ở 1300 → `page = 1`, `page_end = 2`.

Bước 2: cắt, rồi tìm lại vị trí mỗi mảnh trong `full_text`:

```python
    raw: list[tuple[str, int, int]] = []  # (text, start, end)
    cursor = 0
    for piece in splitter.split_text(full_text):
        text = piece.strip()
        if not text:
            continue
        start = full_text.find(text, cursor)          # ← tìm từ cursor trở đi (vì có overlap)
        ...
        raw.append((text, start, min(start + len(text) - 1, len(full_text) - 1)))
```

Bước 3: gộp đoạn quá nhỏ:

```python
    def is_small(text: str) -> bool:
        return bool(min_chunk_size) and n_tokens(text) < min_chunk_size

    merged: list[tuple[str, int, int]] = []
    for text, start, end in raw:
        if merged and (is_small(text) or is_small(merged[-1][0])):
            prev_text, prev_start, prev_end = merged[-1]
            extra = full_text[max(prev_end + 1, start) : end + 1].strip()  # ← bỏ phần overlap trùng lặp
            candidate = f"{prev_text}\n{extra}" if extra else prev_text
            if n_tokens(candidate) <= chunk_size:      # ← e5 chỉ nhận tối đa 512 token
                merged[-1] = (candidate, prev_start, max(end, prev_end))
                continue
        merged.append((text, start, end))

    return [Chunk(i, text, page_at(start), page_at(end)) for i, (text, start, end) in enumerate(merged)]
```

> 💡 **Đánh đổi kinh điển:**
> - Chunk **nhỏ** → tìm chính xác hơn nhưng thiếu ngữ cảnh, LLM đọc "cụt".
> - Chunk **lớn** → nhiều ngữ cảnh nhưng vector bị "loãng", tìm kém chính xác, tốn chỗ trong prompt.

### Tầng 4: Embedding, biến chữ thành vector (`ingest/embedder.py`)

**Embedding** là một hàm: `văn bản → mảng số thực` (ở đây **384 số**, vì `multilingual-e5-small` có `dim=384`).

Tính chất quan trọng: **hai đoạn có ý nghĩa giống nhau sẽ có vector gần nhau**, kể cả khi dùng từ khác nhau:

```
"Nhân viên được nghỉ phép 12 ngày/năm"   → [0.02, -0.11, 0.07, ...]  ┐
"Mỗi năm tôi có bao nhiêu ngày phép?"     → [0.03, -0.09, 0.08, ...]  ┘ gần nhau
"Cách cài đặt máy in"                     → [-0.15, 0.04, -0.02, ...]   xa
```

**Đo "gần" bằng cosine similarity:**

```
cos(a, b) = (a · b) / (|a| · |b|)      ∈ [-1, 1], càng lớn càng giống
```

Code gọi `encode(..., normalize_embeddings=True)` để mọi vector có độ dài = 1. Khi đó `|a| = |b| = 1` nên **cosine = tích vô hướng (a · b)**. Đó là lý do FAISS dùng `IndexFlatIP` (Inner Product).

**Tiền tố `passage:` / `query:`:** họ mô hình e5 được huấn luyện *bất đối xứng*: câu hỏi thì ngắn, đoạn văn thì dài. Phải thêm đúng tiền tố:
- Khi nạp tài liệu: `"passage: " + đoạn văn`
- Khi hỏi: `"query: " + câu hỏi`

Quên tiền tố thì điểm vẫn ra nhưng chất lượng tìm kiếm giảm rõ rệt (một lỗi rất hay gặp).

**Batch:** nhúng 32 đoạn một lần (`EMBEDDING_BATCH_SIZE`) để tận dụng GPU, và báo tiến độ theo từng batch.

📄 **Code** (`ingest/embedder.py`):

```python
class Embedder:
    def __init__(self, model_name, device, batch_size, doc_prefix, query_prefix):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(model_name, device=device)
        self.doc_prefix = doc_prefix          # "passage: "
        self.query_prefix = query_prefix      # "query: "
        self.dimension: int = self.model.get_sentence_embedding_dimension()   # ← 384 với e5-small
        self._lock = threading.Lock()         # ← mô hình dùng chung giữa các thread

    @property
    def tokenizer(self):
        return self.model.tokenizer           # ← chunker mượn tokenizer này để đếm token

    def embed_documents(self, texts, on_progress=None) -> np.ndarray:
        parts: list[np.ndarray] = []
        total = len(texts)
        for start in range(0, total, self.batch_size):
            batch = [self.doc_prefix + t for t in texts[start : start + self.batch_size]]   # ← "passage: ..."
            with self._lock:
                parts.append(
                    self.model.encode(batch, normalize_embeddings=True,                     # ← |v| = 1
                                      show_progress_bar=False, convert_to_numpy=True)
                )
            if on_progress:
                on_progress(min(start + len(batch), total), total)
        return np.vstack(parts).astype("float32")     # ← ma trận (số_chunk × 384)

    def embed_query(self, text: str) -> np.ndarray:
        with self._lock:
            vec = self.model.encode(
                [self.query_prefix + text], normalize_embeddings=True,                     # ← "query: ..."
                show_progress_bar=False, convert_to_numpy=True
            )
        return vec[0].astype("float32")               # ← 1 vector 384 số
```

Mô hình chỉ được nạp **một lần** (singleton), vì nạp mô hình tốn vài giây và vài trăm MB bộ nhớ:

```python
def get_embedder() -> Embedder:
    global _instance
    if _instance is None:
        with _instance_lock:
            if _instance is None:            # ← "double-checked locking": 2 thread cùng gọi vẫn chỉ nạp 1 lần
                _instance = Embedder(...)
    return _instance
```

---

## 3. Lưu trữ: dữ liệu nằm ở đâu?

Đây là phần nhiều người nhầm. Dự án dùng **2 lớp lưu trữ**:

```
┌──────────────────────────────── TRÊN ĐĨA (bền vững) ────────────────────────────────┐
│ storage/app.db  (SQLite) ← NGUỒN SỰ THẬT DUY NHẤT                                    │
│   documents : file nào, trạng thái, % tiến độ, fingerprint                           │
│   chunks    : text, doc_id, page, page_end, chunk_index, embedding (BLOB float32)    │
│   images    : ảnh thuộc trang nào của tài liệu nào                                   │
│   messages  : câu hỏi, câu viết lại, câu trả lời, nguồn (JSON)                       │
│   feedback  : 👍 / 👎                                                                 │
│ storage/uploads/  : file gốc người dùng tải lên                                       │
│ storage/images/   : ảnh xuất từ PDF                                                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
                        │  đọc toàn bộ chunks khi cần
                        ▼
┌──────────────────────────────── TRONG RAM (tạm, dựng lại được) ──────────────────────┐
│ FAISS index : các vector, để tìm "gần nghĩa" thật nhanh                              │
│ BM25 index  : thống kê từ khoá, để chấm điểm "khớp chữ"                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Bảng `chunks`, trái tim của hệ thống

| Cột | Ví dụ | Dùng để |
|---|---|---|
| `id` | `"9f1c..."` (UUID) | Khoá để FAISS/BM25 trỏ về |
| `doc_id` | `"a12b..."` | Lọc theo tài liệu, xoá dây chuyền (`ON DELETE CASCADE`) |
| `chunk_index` | `7` | Thứ tự đoạn trong file |
| `text` | `"Nhân viên chính thức..."` | Đưa vào prompt, hiển thị nguồn |
| `filename`, `page`, `page_end` | `"noi-quy.pdf"`, `3`, `4` | Trích dẫn "trang 3–4" |
| `embedding` | 1536 bytes | `384 số × 4 byte (float32)` = vector của đoạn |

Vector được lưu dạng **bytes thô**: `vectors[i].tobytes()` khi ghi và `np.frombuffer(..., dtype="float32")` khi đọc.

📄 **Schema** (`db.py`):

```sql
CREATE TABLE IF NOT EXISTS documents (
    id           TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    file_type    TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    status       TEXT NOT NULL,          -- processing | ready | error
    progress     INTEGER NOT NULL DEFAULT 0,
    stage        TEXT,
    error        TEXT,
    num_pages    INTEGER NOT NULL DEFAULT 0,
    num_chunks   INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'upload',   -- upload | folder (tự nạp từ PDF_PATH)
    fingerprint  TEXT,                             -- đường dẫn + kích thước + mtime, tránh nạp trùng
    uploaded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id           TEXT PRIMARY KEY,
    doc_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index  INTEGER NOT NULL,
    text         TEXT NOT NULL,
    filename     TEXT NOT NULL,
    page         INTEGER,
    page_end     INTEGER,
    uploaded_at  TEXT NOT NULL,
    embedding    BLOB NOT NULL                     -- float32, dùng để dựng lại chỉ mục FAISS
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

CREATE TABLE IF NOT EXISTS images (
    id        TEXT PRIMARY KEY,
    doc_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page      INTEGER NOT NULL,
    filename  TEXT NOT NULL,                       -- tên file trong IMAGE_OUTPUT_DIR
    width     INTEGER NOT NULL,
    height    INTEGER NOT NULL,
    ocr_text  TEXT
);
CREATE INDEX IF NOT EXISTS idx_images_doc_page ON images(doc_id, page);
```

📄 **Ghi chunk vào DB** (`ingest/pipeline.py`):

```python
db.insert_chunks(
    [
        {
            "id": str(uuid.uuid4()),
            "doc_id": doc_id,
            "filename": filename,
            "page": c.page,
            "page_end": c.page_end,
            "chunk_index": c.index,
            "uploaded_at": uploaded_at,
            "text": c.text,
            "embedding": vectors[i].tobytes(),     # ← numpy float32[384] → 1536 bytes
        }
        for i, c in enumerate(chunks)
    ]
)
```

📄 **Đọc chunk để dựng chỉ mục** (`db.py`): chỉ lấy chunk của tài liệu đã `ready`, để tài liệu đang nạp dở không lọt vào kết quả tìm kiếm:

```python
def all_chunks(with_embedding: bool = False) -> list[dict[str, Any]]:
    cols = "c.*" if with_embedding else (
        "c.id, c.doc_id, c.chunk_index, c.text, c.filename, c.page, c.page_end, c.uploaded_at"
    )
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT {cols} FROM chunks c JOIN documents d ON d.id = c.doc_id
                WHERE d.status = 'ready' ORDER BY c.doc_id, c.chunk_index"""
        ).fetchall()
    return [dict(r) for r in rows]
```

Kết nối bật `PRAGMA foreign_keys = ON` (để `ON DELETE CASCADE` có tác dụng) và `journal_mode = WAL` (cho phép đọc trong lúc thread khác đang ghi).

### 3.2 Tại sao vector nằm trong SQLite mà vẫn cần FAISS?

- **SQLite** giỏi lưu trữ bền vững và truy vấn theo khoá, nhưng **không biết** tìm "vector nào gần nhất".
- **FAISS** (thư viện của Meta) giỏi tìm vector gần nhất cực nhanh, nhưng ở đây nó chỉ sống trong RAM.

Thiết kế: **SQLite là nguồn sự thật**, còn FAISS/BM25 là **cache dựng lại được**.

📄 **Code** (`retrieval/faiss_index.py`):

```python
_index: FaissIndex | None = None
_lock = threading.Lock()


def get_faiss() -> FaissIndex:
    global _index
    with _lock:
        if _index is None:
            _index = FaissIndex()      # ← đọc TẤT CẢ embedding từ SQLite, dựng lại
        return _index


def invalidate_faiss() -> None:       # ← pipeline gọi hàm này sau khi nạp xong 1 tài liệu
    global _index
    with _lock:
        _index = None
```

Kiểu này gọi là **lazy rebuild**. Ưu điểm: đơn giản, không bao giờ lệch dữ liệu, khởi động lại máy không mất gì. Nhược điểm: kho rất lớn (hàng triệu đoạn) thì dựng lại sẽ chậm; lúc đó người ta dùng vector DB chuyên dụng (Qdrant, Milvus, pgvector...) hoặc thêm vector tăng dần (`index.add`) thay vì dựng lại.

### 3.3 Ba loại chỉ mục FAISS (`VECTOR_INDEX_TYPE`)

| Loại | Cách tìm | Chính xác | Tốc độ | Khi nào dùng |
|---|---|---|---|---|
| `flat` | So câu hỏi với **từng** vector một (brute force) | 100% | O(N) | Tới vài trăm nghìn đoạn. **Mặc định, đủ cho dự án này** |
| `hnsw` | Đi trên đồ thị "hàng xóm" nhiều tầng, nhảy dần tới vùng gần | ~95–99% | Rất nhanh | Kho lớn, cần độ trễ thấp |
| `ivf` | Chia vector thành `nlist=64` cụm (k-means); khi tìm chỉ xét `nprobe=8` cụm gần nhất | ~90–99% | Nhanh | Kho lớn. Cần train và cần ≥ `nlist` đoạn, nếu không code tự quay về `flat` |

> 💡 `hnsw` và `ivf` là **ANN** (Approximate Nearest Neighbor): đổi một chút độ chính xác lấy tốc độ.

📄 **Dựng chỉ mục** (`retrieval/faiss_index.py`):

```python
class FaissIndex:
    def __init__(self) -> None:
        s = get_settings()
        rows = db.all_chunks(with_embedding=True)
        self.ids: list[str] = [r["id"] for r in rows]          # ← vị trí i trong FAISS ↔ chunk_id
        self.doc_ids: list[str] = [r["doc_id"] for r in rows]
        self.index = None
        if not rows:
            return
        vectors = np.vstack([np.frombuffer(r["embedding"], dtype="float32") for r in rows])  # ← BLOB → numpy
        dim = vectors.shape[1]                                  # ← 384
        kind = s.vector_index_type

        if kind == "hnsw":
            index = faiss.IndexHNSWFlat(dim, s.faiss_hnsw_m, faiss.METRIC_INNER_PRODUCT)
            index.hnsw.efSearch = max(64, s.hybrid_candidates * 2)   # ← độ rộng tìm kiếm trên đồ thị
        elif kind == "ivf" and len(rows) >= s.faiss_ivf_nlist:
            quantizer = faiss.IndexFlatIP(dim)
            index = faiss.IndexIVFFlat(quantizer, dim, s.faiss_ivf_nlist, faiss.METRIC_INNER_PRODUCT)
            index.train(vectors)                                # ← k-means chia 64 cụm
            index.nprobe = s.faiss_ivf_nprobe                   # ← khi tìm chỉ xét 8 cụm gần nhất
        else:
            index = faiss.IndexFlatIP(dim)                      # ← brute force, IP = cosine vì đã chuẩn hoá
        index.add(vectors)
        self.index = index
```

FAISS chỉ biết **vị trí** (0, 1, 2...), không biết `chunk_id`. Vì vậy cần mảng `self.ids` để đổi vị trí thành `chunk_id`, rồi dùng `chunk_id` lấy text từ SQLite.

### 3.4 BM25, chỉ mục từ khoá (`retrieval/bm25.py`)

BM25 là thuật toán tìm kiếm "cổ điển" (kiểu Google đời đầu, Elasticsearch). Nó **không hiểu nghĩa**, chỉ đếm từ:

- **TF (term frequency)**: từ khoá xuất hiện nhiều trong đoạn thì điểm cao hơn (có bão hoà, không tăng mãi).
- **IDF (inverse document frequency)**: từ **hiếm** trong toàn kho (ví dụ "ISO-27001") có trọng số cao; từ phổ biến có trọng số thấp.
- **Chuẩn hoá độ dài**: đoạn dài không được lợi thế chỉ vì dài.

Code tách từ bằng regex `\w+` và bỏ **stopwords** ("và", "là", "của", "the", "of"...).

**Tại sao cần BM25 khi đã có embedding?** Embedding hay **yếu với từ khoá chính xác**: mã sản phẩm `SKU-4471`, tên riêng, số hiệu điều luật "Điều 15", từ viết tắt. Embedding có thể coi "Điều 15" và "Điều 16" là gần nhau; BM25 thì phân biệt rõ.

📄 **Code** (`retrieval/bm25.py`):

```python
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)

_STOPWORDS = {
    "và", "là", "của", "có", "được", "cho", "các", "những", "một", "trong", "với", "này", "đó",
    ...
    "the", "a", "an", "of", "to", "in", "and", "or", "is", "are", ...
}


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text.lower())          # ← NFC lần nữa cho câu hỏi
    return [t for t in _TOKEN_RE.findall(text) if t not in _STOPWORDS]
    # "Chính sách nghỉ ốm của công ty?" → ["chính", "sách", "nghỉ", "ốm", "công", "ty"]


class BM25Index:
    def __init__(self, chunks: list[dict[str, Any]]):
        self.ids = [c["id"] for c in chunks]
        self.doc_ids = [c["doc_id"] for c in chunks]
        self.pos = {cid: i for i, cid in enumerate(self.ids)}   # ← chunk_id → vị trí
        corpus = [tokenize(c["text"]) or ["_"] for c in chunks]
        self.bm25 = BM25Okapi(corpus) if corpus else None       # ← tính sẵn TF, IDF, độ dài TB

    def scores_for(self, query: str, chunk_ids: list[str]) -> dict[str, float]:
        """Điểm BM25 (IDF tính trên toàn kho) cho một tập ứng viên cụ thể."""
        if self.bm25 is None:
            return {}
        q = tokenize(query)
        if not q:
            return {}
        positions = [self.pos[c] for c in chunk_ids if c in self.pos]
        scores = self.bm25.get_batch_scores(q, positions)       # ← chỉ chấm các ứng viên FAISS đưa sang
        return {self.ids[p]: float(sc) for p, sc in zip(positions, scores)}
```

Lưu ý: tách từ theo `\w+` nghĩa là tiếng Việt được tách **theo âm tiết** ("chính", "sách"), không theo từ ghép ("chính sách"). Cách này đơn giản và vẫn chạy ổn; muốn tốt hơn có thể dùng thư viện tách từ tiếng Việt (underthesea, pyvi).

### 3.5 Chống nạp trùng: fingerprint

Khi tự nạp từ thư mục `data/`, mỗi file có `fingerprint = đường dẫn + kích thước + thời gian sửa`. Nếu fingerprint đã có trong bảng `documents` thì bỏ qua, không nạp lại.

📄 **Code** (`ingest/autoload.py`):

```python
def ingest_folder() -> int:
    s = get_settings()
    folder = s.pdf_path
    count = 0
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        file_type = detect_type(path.name)
        if file_type is None:
            continue                                         # ← bỏ file không hỗ trợ
        stat = path.stat()
        fingerprint = f"{path.resolve()}|{stat.st_size}|{int(stat.st_mtime)}"
        existing = db.find_by_fingerprint(fingerprint)
        if existing and existing["status"] != "error":
            continue                                         # ← đã nạp rồi, file không đổi
        if existing:                                         # ← lần trước lỗi → xoá và thử lại
            db.delete_document(existing["id"])
        doc_id = str(uuid.uuid4())
        db.create_document(doc_id, path.name, file_type, stat.st_size, source="folder", fingerprint=fingerprint)
        ingest_document(doc_id, path, path.name, file_type)
        count += 1
    return count
```

Sửa file thì `mtime` thay đổi nên fingerprint mới, file được nạp lại. Nhưng bản cũ **không tự bị xoá**: nếu sửa file trong `data/`, hãy xoá bản cũ trên giao diện để khỏi bị trùng nội dung.

---

## 4. Luồng B: truy xuất và trả lời

Điều phối trong `api/chat.py` → `_chat_events()`.

### Tầng 6: Query rewriting (`llm/rewrite.py`)

Vấn đề: hội thoại nhiều lượt.

```
User: Gói Premium có những tính năng gì?
Bot:  ...
User: Nó giá bao nhiêu?          ← embed câu này thì vector chẳng chứa "Premium" nào cả!
```

Giải pháp: trước khi tìm, nhờ LLM viết lại câu hỏi thành câu **độc lập**: `"Gói Premium giá bao nhiêu?"`.

- Chỉ chạy khi có lịch sử và `QUERY_REWRITE_ENABLED=true`.
- Lấy tối đa 6 lượt gần nhất, mỗi lượt cắt ở 1000 ký tự.
- **An toàn khi lỗi**: LLM lỗi, trả về rỗng hoặc trả về quá dài (> 4× câu gốc + 300) thì dùng câu hỏi gốc.
- Chi phí: tốn thêm 1 lượt chạy LLM (tối đa 128 token).

📄 **Code** (`llm/rewrite.py`):

```python
async def rewrite_question(question: str, history: list[Message]) -> str:
    """Không có lịch sử → giữ nguyên. Lỗi khi viết lại → dùng câu hỏi gốc (không chặn luồng chat)."""
    if not history or not get_settings().query_rewrite_enabled:
        return question
    try:
        llm = await run_in_threadpool(get_llm)
        rewritten = await llm.complete(
            REWRITE_SYSTEM_PROMPT,
            [{"role": "user", "content": build_rewrite_request(question, history)}],
            max_new_tokens=128,
        )
    except LLMError as exc:
        log.warning("Query rewriting thất bại, dùng câu hỏi gốc: %s", exc)
        return question
    rewritten = rewritten.strip().strip('"').strip()
    if not rewritten or len(rewritten) > 4 * len(question) + 300:   # ← LLM "lan man" → bỏ
        return question
    return rewritten
```

📄 **Prompt viết lại** (`llm/prompts.py`):

```python
REWRITE_SYSTEM_PROMPT = """Bạn viết lại câu hỏi cho hệ thống tìm kiếm tài liệu.
Dựa vào lịch sử hội thoại, hãy viết lại CÂU HỎI MỚI NHẤT thành một câu hỏi độc lập,
đầy đủ ngữ cảnh (thay đại từ như "nó", "cái đó", "họ" bằng đối tượng cụ thể).
- Giữ nguyên ngôn ngữ của câu hỏi gốc.
- Nếu câu hỏi đã độc lập, trả lại nguyên văn.
- Chỉ trả về đúng một câu hỏi, không giải thích, không thêm tiền tố."""


def build_rewrite_request(question: str, history: list[dict[str, str]]) -> str:
    lines = []
    for turn in history[-6:]:                              # ← chỉ 6 lượt gần nhất
        who = "Người dùng" if turn["role"] == "user" else "Trợ lý"
        content = turn["content"].strip()
        if len(content) > 1000:
            content = content[:1000] + "…"
        lines.append(f"{who}: {content}")
    return (
        "LỊCH SỬ HỘI THOẠI:\n" + "\n".join(lines)
        + f"\n\nCÂU HỎI MỚI NHẤT: {question}\n\nCÂU HỎI ĐỘC LẬP:"   # ← "mồi" để LLM viết tiếp
    )
```

### Tầng 7–8: Dense search + ngưỡng (`retrieval/hybrid.py`, `faiss_index.py`)

```python
qvec  = embedder.embed_query(query)          # "query: ..." → vector 384
dense = faiss.search(qvec, 20)               # 20 ứng viên gần nhất [(chunk_id, cosine)]
kept  = [x for x in dense if cosine >= 0.795]  # SIMILARITY_THRESHOLD
if not kept: return []                       # → trả "Tôi không tìm thấy..." KHÔNG gọi LLM
```

**Ngưỡng tương đồng** là "cửa chặn" chống bịa: không có đoạn nào đủ giống thì không cho LLM trả lời. Với e5, điểm cosine thường nằm trong khoảng 0.77–0.92 (khá dồn cục), nên ngưỡng 0.795 nghe cao nhưng thực ra là vừa. Ngưỡng **phụ thuộc mô hình**: MiniLM chỉ cần khoảng 0.25.

**Lọc theo tài liệu** (`doc_ids`): FAISS không lọc được trong lúc tìm, nên code lấy *dư* (`max(top_k×10, 200)`) rồi lọc sau. Đây là kỹ thuật **post-filtering**.

📄 **Tìm trong FAISS** (`retrieval/faiss_index.py`):

```python
    def search(self, vector: np.ndarray, top_k: int, doc_ids: list[str] | None = None) -> list[tuple[str, float]]:
        """Trả về [(chunk_id, cosine)] giảm dần. Có lọc theo tài liệu thì lấy dư rồi lọc."""
        if self.index is None or top_k <= 0:
            return []
        allowed = set(doc_ids) if doc_ids else None
        k = top_k if allowed is None else min(len(self.ids), max(top_k * 10, 200))   # ← lấy dư khi có lọc
        k = min(k, len(self.ids))
        scores, idx = self.index.search(vector.reshape(1, -1).astype("float32"), k)  # ← gọi FAISS
        out: list[tuple[str, float]] = []
        for score, i in zip(scores[0], idx[0]):
            if i < 0:                                          # ← FAISS trả -1 khi không đủ kết quả
                continue
            if allowed is not None and self.doc_ids[i] not in allowed:
                continue                                       # ← post-filter theo tài liệu
            out.append((self.ids[i], float(score)))           # ← vị trí i → chunk_id
            if len(out) >= top_k:
                break
        return out
```

📄 **Phần đầu của `retrieve()`** (`retrieval/hybrid.py`):

```python
def retrieve(query: str, doc_ids: list[str] | None = None) -> list[RetrievedChunk]:
    s = get_settings()
    hybrid = s.retrieval_mode == "hybrid"

    qvec = get_embedder().embed_query(query)                               # ← "query: ..." → vector
    n_candidates = max(s.hybrid_candidates, s.top_k) if hybrid else s.top_k  # ← hybrid: 20, dense: 5
    dense = get_faiss().search(qvec, n_candidates, doc_ids)
    kept = [(cid, sim) for cid, sim in dense if sim >= s.similarity_threshold]   # ← cửa chặn ngưỡng
    if not kept:
        return []                                                          # ← chat.py sẽ trả NOT_FOUND_ANSWER
```

### Tầng 9: Hybrid rerank bằng RRF

Có 2 bảng xếp hạng cho cùng các ứng viên: theo **nghĩa** (dense) và theo **từ khoá** (BM25). Làm sao trộn?

Không cộng điểm trực tiếp được, vì cosine ∈ [0, 1] còn BM25 có thể là 0 → 30, hai thang đo khác nhau. **RRF (Reciprocal Rank Fusion)** chỉ dùng **thứ hạng**:

```
RRF(d) = 1/(k + rank_dense(d)) + 1/(k + rank_bm25(d))       với k = 60 (HYBRID_RRF_K)
```

Đoạn nào BM25 = 0 (không khớp từ nào) thì không có thành phần thứ hai.

**Ví dụ tính tay:**

| Chunk | Hạng dense | Hạng BM25 | RRF |
|---|---|---|---|
| A | 1 | 3 | 1/61 + 1/63 = 0.01639 + 0.01587 = **0.03226** |
| B | 2 | 1 | 1/62 + 1/61 = 0.01613 + 0.01639 = **0.03252** ← lên số 1 |
| C | 3 | – | 1/63 = **0.01587** |

→ B vượt A vì vừa gần nghĩa vừa khớp từ khoá tốt nhất. C chỉ gần nghĩa nên tụt xuống.

`k = 60` làm "mềm" chênh lệch giữa các hạng. k nhỏ thì hạng 1 áp đảo; k lớn thì các hạng gần như ngang nhau.

> ⚠️ **Chi tiết tinh tế của dự án này:** BM25 ở đây chỉ **xếp lại** 20 ứng viên mà FAISS đã tìm (`bm25.scores_for(...)`), chứ **không tìm thêm** ứng viên mới. Nghĩa là một đoạn khớp đúng từ khoá nhưng cosine < ngưỡng sẽ **không bao giờ** được chọn. Nhiều hệ thống khác cho BM25 tìm song song trên toàn kho rồi mới hợp nhất (`bm25.search()` đã có sẵn trong code nhưng chưa dùng). Đây là một hướng cải tiến để bạn thử.

Cuối cùng lấy **top 5** (`TOP_K`) và cộng dồn độ dài cho tới `MAX_CONTEXT_CHARS = 12000` ký tự. Đoạn nào làm tràn ngân sách thì dừng (không cắt dở, trừ khi đó là đoạn đầu tiên).

📄 **Phần RRF trong `retrieve()`** (`retrieval/hybrid.py`):

```python
def _rank(scores: dict[str, float]) -> dict[str, int]:
    """Thứ hạng 1..n theo điểm giảm dần; chỉ tính các điểm > 0."""
    ordered = sorted((cid for cid, sc in scores.items() if sc > 0), key=lambda c: scores[c], reverse=True)
    return {cid: r for r, cid in enumerate(ordered, start=1)}


    # ... tiếp theo trong retrieve():
    similarity = dict(kept)
    bm25_scores: dict[str, float] = {}
    if hybrid:
        bm25_scores = get_bm25().scores_for(query, [cid for cid, _ in kept])   # ← BM25 chỉ trên ứng viên
        dense_rank = {cid: r for r, (cid, _) in enumerate(kept, start=1)}     # ← kept đã xếp theo cosine
        bm25_rank = _rank(bm25_scores)
        k = s.hybrid_rrf_k                                                    # ← 60
        final = {
            cid: 1.0 / (k + dense_rank[cid])
                 + (1.0 / (k + bm25_rank[cid]) if cid in bm25_rank else 0.0)  # ← BM25 = 0 thì không cộng
            for cid in similarity
        }
    else:
        final = similarity                                                    # ← dense: dùng luôn cosine

    top_ids = sorted(final, key=lambda c: final[c], reverse=True)[: s.top_k]  # ← top 5
```

📄 **Lấy text từ SQLite và cắt theo ngân sách ký tự:**

```python
    rows = db.get_chunks_by_ids(top_ids)        # ← chunk_id → text, filename, page...

    results: list[RetrievedChunk] = []
    budget = s.max_context_chars                # ← 12000
    for cid in top_ids:
        row = rows.get(cid)
        if row is None:
            continue
        text = row["text"]
        if len(text) > budget:
            if results:
                break                           # ← đã có ngữ cảnh, không cắt dở đoạn tiếp theo
            text = text[:budget]                # ← đoạn đầu tiên quá dài thì đành cắt
        budget -= len(text)
        results.append(RetrievedChunk(id=cid, doc_id=row["doc_id"], filename=row["filename"],
                                      page=row["page"], page_end=row["page_end"], ...,
                                      text=text, score=float(final[cid]),
                                      similarity=float(similarity[cid]), bm25_score=bm25_scores.get(cid)))
        if budget <= 0:
            break
    return results
```

### Tầng 10: Dựng prompt (`llm/prompts.py`)

LLM nhận:

```
[SYSTEM]
Bạn là trợ lý trả lời câu hỏi dựa trên tài liệu nội bộ.
- Chỉ trả lời dựa trên NGỮ CẢNH.
- Không đủ thông tin → "Tôi không tìm thấy thông tin này trong tài liệu". Không bịa.
- Gắn [1], [2] sau mỗi ý.
- Nguồn mâu thuẫn → nêu rõ, trích cả hai.

[lịch sử: user / assistant ... (tối đa 4 lượt, chỉ văn bản thuần)]

[USER]
NGỮ CẢNH:
[1] (Nguồn: noi-quy.pdf, trang 3–4)
Nhân viên chính thức được nghỉ phép 12 ngày mỗi năm...

[2] (Nguồn: so-tay.docx, trang 7)
...

CÂU HỎI: Mỗi năm nhân viên được nghỉ phép bao nhiêu ngày?
```

Ba điểm thiết kế đáng học:
1. **Đánh số nguồn** `[1]`, `[2]` trong ngữ cảnh, nên LLM có thể trích dẫn và giao diện map số về đúng đoạn.
2. **Câu hỏi đặt sau ngữ cảnh**: LLM nhỏ "nhớ" phần cuối prompt tốt hơn.
3. Lịch sử chỉ gồm văn bản thuần; **ngữ cảnh chỉ gắn vào lượt cuối**, tránh prompt phình to theo mỗi lượt.

📄 **Code** (`llm/prompts.py`):

```python
SYSTEM_PROMPT = """Bạn là trợ lý trả lời câu hỏi dựa trên tài liệu nội bộ.

Quy tắc:
- Chỉ trả lời dựa trên thông tin trong phần NGỮ CẢNH bên dưới.
- Nếu ngữ cảnh không đủ để trả lời, nói rõ: "Tôi không tìm thấy thông tin này
  trong tài liệu" và gợi ý người dùng hỏi cách khác. Không tự bịa thông tin.
- Sau mỗi ý lấy từ tài liệu, gắn số trích dẫn dạng [1], [2] tương ứng với đoạn nguồn.
- Trả lời bằng ngôn ngữ của câu hỏi, ngắn gọn, rõ ràng.
- Nếu các đoạn nguồn mâu thuẫn nhau, nêu rõ sự mâu thuẫn và trích cả hai nguồn."""

CONTEXT_TEMPLATE = """NGỮ CẢNH:
{context}

CÂU HỎI: {question}"""


def page_label(page: int | None, page_end: int | None) -> str:
    if page is None:
        return "?"
    if page_end is not None and page_end != page:
        return f"{page}–{page_end}"                       # ← "3–4" khi chunk vắt 2 trang
    return str(page)


def build_context(chunks: list[RetrievedChunk]) -> str:
    blocks = []
    for i, c in enumerate(chunks, start=1):               # ← đánh số [1], [2]... theo thứ tự RRF
        blocks.append(f"[{i}] (Nguồn: {c.filename}, trang {page_label(c.page, c.page_end)})\n{c.text}")
    return "\n\n".join(blocks)


def build_user_turn(question: str, chunks: list[RetrievedChunk]) -> str:
    return CONTEXT_TEMPLATE.format(context=build_context(chunks), question=question)
```

📄 **Ghép lịch sử + lượt cuối** (`api/chat.py`):

```python
def normalize_history(history: list[dict[str, str]], max_turns: int = 4) -> list[dict[str, str]]:
    """Giữ các lượt gần nhất, bắt đầu bằng 'user', xen kẽ user/assistant, kết thúc bằng 'assistant'."""
    merged: list[dict[str, str]] = []
    for turn in history[-max_turns:]:
        if merged and merged[-1]["role"] == turn["role"]:      # ← 2 lượt cùng vai liền nhau → gộp
            merged[-1] = {"role": turn["role"], "content": merged[-1]["content"] + "\n\n" + turn["content"]}
        else:
            merged.append(dict(turn))
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    while merged and merged[-1]["role"] != "assistant":
        merged.pop()
    return merged

# trong _chat_events():
messages = [*normalize_history(history), {"role": "user", "content": build_user_turn(search_query, chunks)}]
```

Chat template của Qwen yêu cầu các lượt **xen kẽ** user/assistant, nên mới cần hàm chuẩn hoá này.

### Tầng 11: Sinh câu trả lời và stream (`llm/client.py`, `api/chat.py`)

- Qwen3-4B bản nén **4-bit** (~2,65 GB) để vừa GPU 4 GB.
- **Prefill theo khối 512 token**: prompt dài được "đọc" từng khúc để giảm đỉnh VRAM.
- `QWEN_DO_SAMPLE=false` → **greedy decoding** (luôn chọn token xác suất cao nhất), nên câu trả lời ổn định, ít "sáng tạo", hợp với RAG.
- Trả về qua **Server-Sent Events**; thứ tự sự kiện:
  ```
  status(rewriting) → rewrite → status(retrieving) → sources → status(generating) → token, token, token... → done
  ```
  Gửi `sources` **trước** khi sinh, nên giao diện hiện được nguồn ngay khi chữ còn đang chạy.

📄 **Tham số sinh** (`llm/client.py`):

```python
    def _gen_kwargs(self, max_new_tokens: int) -> dict:
        s = self.settings
        kw: dict = {
            "max_new_tokens": max_new_tokens,                 # ← 512
            "do_sample": s.qwen_do_sample,                    # ← False = greedy
            "pad_token_id": self.tokenizer.pad_token_id or self.tokenizer.eos_token_id,
        }
        if s.qwen_do_sample:
            kw.update(temperature=s.qwen_temperature, top_p=s.qwen_top_p, top_k=s.qwen_top_k)
        else:
            kw.update(temperature=None, top_p=None, top_k=None)
        return kw
```

📄 **Prefill theo khối:** đưa prompt vào **KV cache** từng khúc 512 token, thay vì đưa cả 4000 token một lúc (một lúc thì đỉnh VRAM cao, GPU 4 GB dễ tràn):

```python
    def _prefill(self, input_ids):
        """Nạp prompt vào KV cache theo từng khối, chừa token cuối cho generate()."""
        chunk = self.settings.llm_prefill_chunk_size
        n = input_ids.shape[1]
        if chunk <= 0 or n <= chunk:
            return None                                       # ← prompt ngắn: khỏi chia
        cache = DynamicCache()
        for start in range(0, n - 1, chunk):
            end = min(start + chunk, n - 1)
            self.model(input_ids=input_ids[:, start:end], past_key_values=cache,
                       use_cache=True, logits_to_keep=1)      # ← chỉ cần cập nhật cache, bỏ logits
        return cache
```

📄 **Sinh trong thread, đẩy từng token qua hàng đợi:** `model.generate()` là hàm chặn (blocking), nên nó chạy trong thread riêng. Mỗi khi có chữ mới, streamer đẩy chữ vào `asyncio.Queue`; phía async lấy ra và `yield` về cho SSE:

```python
    async def stream(self, system: str, messages: list[Message]) -> AsyncIterator[str]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        stop = threading.Event()

        class _QueueStreamer(TextStreamer):
            def on_finalized_text(self, text: str, stream_end: bool = False) -> None:
                if text:
                    loop.call_soon_threadsafe(queue.put_nowait, text)    # ← thread → event loop

        streamer = _QueueStreamer(self.tokenizer, skip_prompt=True, skip_special_tokens=True)

        def worker() -> None:
            self._generate(system, messages, max_new, streamer=streamer, stop=stop)
            loop.call_soon_threadsafe(queue.put_nowait, None)            # ← None = hết

        future = loop.run_in_executor(None, worker)
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item                                                # ← 1 mẩu chữ
        finally:
            stop.set()      # ← người dùng ngắt kết nối/bấm dừng → dừng sinh để giải phóng GPU
```

Trong `_generate()` có `with self._lock:` nên **mỗi lúc GPU chỉ sinh một câu trả lời**; yêu cầu khác phải xếp hàng.

📄 **Luồng sự kiện SSE** (`api/chat.py`, rút gọn):

```python
def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"   # ← định dạng chuẩn SSE


async def _chat_events(req: ChatRequest) -> AsyncIterator[str]:
    message_id = str(uuid.uuid4())
    question = req.question.strip()
    history = [{"role": t.role, "content": t.content} for t in req.history if t.content.strip()]

    search_query = question
    if history:
        yield _sse("status", {"stage": "rewriting", "message": "Đang hiểu ngữ cảnh câu hỏi..."})
        search_query = await rewrite_question(question, history)              # ← Tầng 6
        if search_query != question:
            yield _sse("rewrite", {"question": search_query})

    yield _sse("status", {"stage": "retrieving", "message": "Đang tìm trong tài liệu..."})
    chunks = await run_in_threadpool(retrieve, search_query, req.doc_ids or None)   # ← Tầng 7–9
    sources = _sources(chunks, search_query)
    yield _sse("sources", {"sources": sources})                               # ← gửi nguồn TRƯỚC

    if not chunks:
        yield _sse("token", {"text": NOT_FOUND_ANSWER})                       # ← không gọi LLM
        db.save_message(message_id, question, search_query, NOT_FOUND_ANSWER, [], "none", "none")
        yield _sse("done", {"message_id": message_id})
        return

    yield _sse("status", {"stage": "generating", "message": "Đang soạn câu trả lời..."})
    llm = await run_in_threadpool(get_llm)
    messages = [*normalize_history(history), {"role": "user", "content": build_user_turn(search_query, chunks)}]  # ← Tầng 10
    parts: list[str] = []
    async for text in llm.stream(SYSTEM_PROMPT, messages):                   # ← Tầng 11
        parts.append(text)
        yield _sse("token", {"text": text})

    answer = "".join(parts)
    slim_sources = [{k: v for k, v in s.items() if k != "text"} for s in sources]
    db.save_message(message_id, question, search_query, answer, slim_sources, llm.provider, llm.model_name)  # ← Tầng 12
    yield _sse("done", {"message_id": message_id})
```

Thứ thực sự chạy trên "dây mạng" trông như sau:

```
event: status
data: {"stage": "retrieving", "message": "Đang tìm trong tài liệu..."}

event: sources
data: {"sources": [{"index": 1, "filename": "noi-quy.pdf", "page": 3, ...}]}

event: token
data: {"text": "Nhân viên"}

event: token
data: {"text": " được nghỉ"}
...
```

📄 **Trích đoạn hiển thị cho từng nguồn** (`make_snippet`): chọn câu trong chunk có nhiều từ khoá trùng với câu hỏi nhất, rồi cắt ~280 ký tự từ câu đó:

```python
def make_snippet(text: str, query: str) -> str:
    q = set(tokenize(query))                                   # ← dùng lại tokenize của BM25
    sentences = [s for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    start = 0
    if q and sentences:
        best = max(range(len(sentences)), key=lambda i: len(q & set(tokenize(sentences[i]))))
        start = max(text.find(sentences[best]), 0)
    snippet = text[start:]
    if len(snippet) > SNIPPET_CHARS:                           # ← 280
        cut = snippet.rfind(" ", 0, SNIPPET_CHARS)             # ← cắt ở dấu cách, không cắt giữa từ
        snippet = snippet[: cut if cut > SNIPPET_CHARS // 2 else SNIPPET_CHARS] + "…"
    return ("…" if start > 0 else "") + snippet.strip()
```

### Tầng 12: Lưu lịch sử và đánh giá

- `messages`: câu hỏi gốc, câu đã viết lại, câu trả lời, danh sách nguồn (JSON, bỏ trường `text` cho nhẹ).
📄 **Code** (`db.py`):

```python
def upsert_feedback(message_id: str, rating: int, comment: str | None) -> None:
    msg = get_message(message_id)
    ts = now_iso()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO feedback (message_id, rating, comment, question, answer, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(message_id) DO UPDATE SET          -- ← bấm lại 👍/👎 thì cập nhật, không thêm dòng
                   rating = excluded.rating,
                   comment = COALESCE(excluded.comment, feedback.comment),
                   updated_at = excluded.updated_at""",
            (message_id, rating, comment,
             msg["question"] if msg else None, msg["answer"] if msg else None, ts, ts),
        )
```

- `feedback`: 👍 (1) / 👎 (-1). Truy vấn những câu bị 👎 để tìm chỗ hệ thống yếu:
  ```sql
  SELECT m.question, m.rewritten_question, m.sources, m.answer
  FROM feedback f JOIN messages m ON m.id = f.message_id
  WHERE f.rating = -1;
  ```

---

## 5. Đi xuyên suốt một câu hỏi

```
Lịch sử:   User: "Chính sách nghỉ phép thế nào?"   Bot: "... [1]"
Câu hỏi:   "Thế còn nghỉ ốm?"

[6] rewrite   → "Chính sách nghỉ ốm của công ty như thế nào?"
[7] embed     → "query: Chính sách nghỉ ốm..." → v = [0.04, -0.12, ...] (384 số, |v| = 1)
[8] FAISS     → 20 ứng viên, cosine: 0.871, 0.858, 0.842, ..., 0.781, 0.776
              → lọc ≥ 0.795 còn 12 đoạn
[9] BM25      → chấm điểm từ khoá "chính", "sách", "nghỉ", "ốm", "công", "ty" trên 12 đoạn
    RRF       → xếp lại, lấy top 5, tổng 4 800 ký tự (< 12 000)
[10] prompt   → SYSTEM + lịch sử + "NGỮ CẢNH: [1]..[5]  CÂU HỎI: Chính sách nghỉ ốm..."
[11] Qwen     → "Nhân viên được nghỉ ốm tối đa 30 ngày/năm có hưởng lương [1]..."
[12] SQLite   → lưu vào messages
```

Bật `RAG_VERBOSE=true` trong `.env` để thấy đúng các con số này trong log backend.

---

## 6. Bảng "vặn núm": tham số nào ảnh hưởng gì

| Triệu chứng | Nguyên nhân hay gặp | Thử chỉnh |
|---|---|---|
| Hỏi gì cũng "Tôi không tìm thấy…" | Ngưỡng quá cao | Giảm `SIMILARITY_THRESHOLD` (0.78). Bật `RAG_VERBOSE` xem cosine thật |
| Trả lời lạc đề, bịa | Ngưỡng quá thấp, lọt đoạn rác | Tăng ngưỡng, giảm `TOP_K` |
| Câu trả lời thiếu ý, "cụt" | Chunk quá nhỏ hoặc TOP_K quá ít | Tăng `CHUNK_SIZE` / `TOP_K` (phải nạp lại nếu đổi chunk) |
| Không tìm được mã số, tên riêng | Embedding yếu từ khoá | Dùng `RETRIEVAL_MODE=hybrid`; thử cho BM25 tìm song song |
| Tìm đúng file nhưng sai đoạn | Chunk quá lớn, vector "loãng" | Giảm `CHUNK_SIZE` |
| Hết VRAM | Prompt quá dài | Giảm `MAX_CONTEXT_CHARS`, `LLM_PREFILL_CHUNK_SIZE` |
| Hỏi tiếp "nó" thì sai | Không viết lại câu hỏi | Bật `QUERY_REWRITE_ENABLED` |
| Trích dẫn có header "CÔNG TY ABC" khắp nơi | Chưa bỏ boilerplate | `DOCUMENT_STRIP_BOILERPLATE=true` |

**Nhớ:** đổi `EMBEDDING_MODEL`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `CHUNKING_STRATEGY` thì phải **xoá `storage/` và nạp lại**, vì vector cũ không còn khớp.

---

## 7. Đánh giá một hệ thống RAG

Đánh giá **riêng từng khâu**, đừng chỉ nhìn câu trả lời cuối:

| Khâu | Câu hỏi cần trả lời | Chỉ số |
|---|---|---|
| Truy xuất | Đoạn đúng có nằm trong top-k không? | Recall@k, MRR |
| Sinh | Câu trả lời có bám đúng ngữ cảnh không (không bịa)? | Faithfulness |
| Sinh | Có trả lời đúng câu hỏi không? | Answer relevance |
| Người dùng | Có hài lòng không? | Tỉ lệ 👍/👎 trong bảng `feedback` |

Cách đơn giản để bắt đầu: tự viết 20–30 câu hỏi kèm "đáp án là đoạn nào, trang nào", chạy thử rồi đếm xem bao nhiêu câu có đoạn đúng trong top 5.

---

## 8. Bài tập tự học (trên chính dự án này)

1. **Nhìn vector:** viết script nhỏ đọc 1 dòng trong bảng `chunks`, `np.frombuffer` ra vector, in `shape` và `np.linalg.norm` (phải ≈ 1.0).
2. **Thử bỏ tiền tố:** đặt `EMBEDDING_QUERY_PREFIX=""`, bật `RAG_VERBOSE`, so điểm cosine trước và sau.
3. **Dense vs hybrid:** hỏi một câu chứa mã số/tên riêng ở cả hai chế độ `RETRIEVAL_MODE`, so top 5.
4. **Chunk size:** thử 200 / 500 / 800 (nhớ xoá `storage/`), so chất lượng câu trả lời.
5. **Nâng cấp hybrid:** sửa `retrieve()` để BM25 cũng tìm trên toàn kho (`get_bm25().search(query, 20)`), hợp nhất ứng viên của hai bên rồi mới chạy RRF.
6. **Thêm cross-encoder reranker** (ví dụ `BAAI/bge-reranker-v2-m3`): sau RRF, chấm lại từng cặp (câu hỏi, đoạn) bằng mô hình chuyên rerank. Chậm hơn nhưng thường chính xác hơn hẳn.

---

## 9. Từ điển nhanh

| Thuật ngữ | Nghĩa ngắn gọn |
|---|---|
| **Chunk** | Một đoạn văn bản nhỏ cắt ra từ tài liệu, đơn vị để tìm kiếm |
| **Token** | Mẩu chữ mà mô hình xử lý (≈ 1 từ hoặc 1 phần của từ) |
| **Embedding** | Vector số biểu diễn ý nghĩa của văn bản |
| **Cosine similarity** | Độ giống nhau giữa 2 vector, từ -1 tới 1 |
| **Dense retrieval** | Tìm theo nghĩa bằng embedding |
| **Sparse / lexical retrieval** | Tìm theo từ khoá (BM25) |
| **Hybrid** | Kết hợp dense + sparse |
| **ANN** | Tìm láng giềng gần *xấp xỉ* (HNSW, IVF), nhanh hơn tìm chính xác |
| **RRF** | Trộn nhiều bảng xếp hạng chỉ dựa trên thứ hạng |
| **Rerank** | Xếp lại một danh sách ứng viên nhỏ bằng phương pháp tốt hơn (nhưng chậm hơn) |
| **Query rewriting** | Viết lại câu hỏi cho rõ nghĩa trước khi tìm |
| **Grounding** | Buộc LLM trả lời dựa trên nguồn được cung cấp |
| **Hallucination** | LLM bịa ra thông tin không có trong nguồn |
| **SSE** | Server-Sent Events, server đẩy dữ liệu dần về trình duyệt |
| **Prefill** | Giai đoạn LLM "đọc" toàn bộ prompt trước khi sinh token đầu tiên |
