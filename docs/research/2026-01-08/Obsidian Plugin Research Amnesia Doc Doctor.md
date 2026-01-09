# **Architectural Blueprint for Next-Generation Knowledge Systems: The Amnesia and Doc Doctor Protocol**

## **1\. Introduction: The Cognitive Imperative for Active Knowledge Systems**

In the contemporary landscape of knowledge work, the sheer velocity of information production has outpaced the cognitive capacity of human processing. We face a dual crisis: **Document Amnesia**, the rapid decay of context and retention following the consumption of static documents, and **Structural Entropy**, the inevitable degradation of organized knowledge repositories into unstructured, unnavigable data lakes. The "Amnesia \+ Doc Doctor" protocol proposes a radical architectural intervention within the Obsidian ecosystem to resolve these deficits. This report provides an exhaustive, expert-level analysis of the proposed system, a desktop-first Electron application leveraging **MuPDF WebAssembly (WASM)** for granular document manipulation and the **Anthropic API** alongside local Large Language Models (LLMs) via **transformers.js** for high-level semantic reasoning.

The prevailing paradigm of document interaction is passive rendering. Standard PDF readers—Adobe Acrobat, Preview, browser-based viewers—are engineered to faithfully map binary instructions to pixels on a screen. Their success metric is visual fidelity to a printed page. However, for the researcher, the analyst, and the developer, visual fidelity is merely a baseline requirement. The true objective is *semantic fidelity*—the accurate transfer of complex conceptual structures from the document to the user's mental model and their externalized knowledge base.

This system shifts the paradigm from passive rendering to **Active Intelligence**. It does not merely display a document; it reconstructs it. It treats the PDF not as a final artifact, but as a semi-structured database to be mined, parsed, reflowed, and interwoven with the user's existing knowledge graph. By employing advanced techniques such as algorithmic layout reconstruction, virtual gaze tracking via mouse heuristics, and local Retrieval-Augmented Generation (RAG), the system transforms static files into dynamic, queryable nodes within a living network.

### **1.1 The Desktop-First Advantage in the Age of Local AI**

While the trend in software development has leaned heavily toward cloud-native web applications, the specific requirements of deep research—privacy, latency, and system integration—necessitate a desktop-first approach. Building "Amnesia" on **Electron** allows for a hybrid architecture that combines the best of web technologies (React, D3.js for visualization) with the power of native system access.

Crucially, the utilization of **MuPDF compiled to WASM** enables high-performance document parsing without the fragility of native binary bindings that often plague cross-platform Electron development.1 Furthermore, the emergence of **WebGPU** allows for the execution of quantized embedding models (e.g., Xenova/all-MiniLM-L6-v2) directly in the renderer process via **transformers.js**, enabling features like real-time semantic search and "Concept Drift" analysis without data ever leaving the local machine.3 This local-first architecture is not merely a technical detail; it is a fundamental feature for users handling sensitive intellectual property, medical records, or proprietary codebases.

### **1.2 Addressing Structural Entropy**

Structural Entropy in knowledge management arises when documents are imported into a vault without sufficient metadata or semantic linkage. They become "dark matter"—present but unobservable. "Doc Doctor" acts as an automated archivist. It utilizes **Logical Layout Analysis** algorithms to reverse-engineer the structure of "flat" PDFs, generating Tables of Contents (ToC) where none exist, extracting figures into usable assets, and identifying semantic sections (e.g., "Methodology" vs. "Results").5 This automated structuring is the first line of defense against entropy, ensuring that every imported artifact is immediately navigable and queryable.

The following sections detail the rigorous technical implementation of these concepts, moving from low-level document parsing to high-level AI reasoning, and finally to the user interface patterns that make this complexity accessible.

## ---

**2\. Document Enhancement: Algorithmic Reconstruction of Semantic Hierarchy**

The first capability of the "Doc Doctor" module is the enhancement of the document itself. Most PDFs, particularly older academic papers or scanned reports, lack a structural skeleton. They are essentially collections of glyphs positioned on a coordinate system. To integrate these documents into a knowledge graph, the system must first understand them.

### **2.1 Algorithmic Table of Contents (ToC) Generation**

A usable Table of Contents is the primary mechanism for non-linear reading. When a PDF lacks an embedded /Outlines dictionary, the system must generate one via **Font Histogram Analysis** and **Spatial Heuristics**.

#### **2.1.1 Font Histogram Analysis and Clustering**

The MuPDF library, specifically its stext (structured text) output device, provides a hierarchical representation of the document: Page $\\rightarrow$ Block $\\rightarrow$ Line $\\rightarrow$ Span $\\rightarrow$ Char. Crucially, the Span object contains rich font metadata: font-family, font-size (in points), font-weight, and color.1

The core hypothesis for ToC generation is that visual prominence correlates with structural importance. Headings are almost invariably larger or bolder than body text. The algorithm proceeds as follows:

1. **Extraction and Normalization:** The system iterates through the text spans of the document. Font sizes in PDFs are often floating-point values derived from transformation matrices (e.g., 11.98002 vs 12.00). To perform meaningful statistical analysis, these values are binned to the nearest 0.5 point. Font names are also normalized to merge subsets (e.g., TimesNewRomanPS-BoldMT becomes Times New Roman (Bold)).  
2. **Frequency Distribution:** A histogram is constructed mapping each unique Font Configuration ($F\_{config} \= \\{Size, Weight, Family\\}$) to its character count ($C\_{count}$).  
3. **Baseline Identification:** The $F\_{config}$ with the highest $C\_{count}$ is identified as the **Body Text Baseline** ($F\_{body}$). This serves as the ground truth for "normalcy" within the document context.7  
4. **Candidate Identification:** Any $F\_{config}$ where $Size(F\_{config}) \> Size(F\_{body})$ or $Weight(F\_{config}) \> Weight(F\_{body})$ is flagged as a potential heading.  
5. **Hierarchical Clustering:** Candidate fonts are sorted by visual weight (a function of size and boldness). The cluster with the largest visual weight (and typically lowest frequency) is assigned H1 (Chapter Level). The next distinct cluster is assigned H2 (Section Level), and so on.

#### **2.1.2 Semantic Density and Layout Filtering**

Visual prominence alone produces false positives. A pull quote may be large and italicized; a figure caption might be bold. To refine the ToC candidates, we apply a **Semantic Density Filter**:

* **Token Count Constraint:** Structural headings are concise. A text block with the font characteristics of an H1 but containing 50+ words is likely an emphasized introductory paragraph, not a title. We apply a threshold (e.g., $\< 30$ words) for heading candidates.  
* **Pattern Matching:** We prioritize blocks that begin with numbering schemas (e.g., 1., 1.2, IV., Appendix A) or standard structural keywords (Abstract, Introduction, Methods, Conclusion, References).8  
* **Case Normalization:** Many documents simulate "Small Caps" or "All Caps" using standard fonts. The system detects these patterns using regex and normalizes the casing for the ToC display (e.g., converting "INTRODUCTION" to "Introduction") while retaining the link to the original text.7

#### **2.1.3 Spatial Heuristics for "Invisible" Structure**

In documents with uniform fonts (e.g., typewriter-style scans), font analysis fails. Here, we rely on **Spatial Heuristics** derived from the bbox (bounding box) data provided by MuPDF:

* **Indentation Analysis:** The system calculates the modal left-margin ($X\_{margin}$) of the body text. Lines that deviate from this margin (e.g., hanging indents) are flagged.  
* **Centering Detection:** A line is considered centered if $| (PageWidth/2) \- (X\_{start} \+ Width/2) | \< \\epsilon$. Centered lines in uniform fonts are high-probability candidates for headings.  
* **Whitespace Isolation:** Headings are often preceded by significantly more vertical whitespace than standard lines. We analyze the $\\Delta Y$ between text blocks to identify these "semantic breaks".5

The output of this process is a standardized JSON tree representing the document structure, which the Obsidian plugin renders as a clickable, navigable sidebar, instantly curing the "flatness" of the PDF.

### **2.2 Semantic Outlining and Logical Segmentation**

While the ToC identifies *where* sections are, **Semantic Outlining** identifies *what* they are. This involves classifying sections based on their rhetorical function.

We utilize the **XY-Cut Algorithm** 5 for recursive top-down page segmentation. This algorithm projects the black pixels of the page onto the horizontal and vertical axes. "Valleys" in these projections (runs of zero pixel density) represent structural separators—column gaps, paragraph breaks, or section dividers.

Once blocks are segmented, a lightweight classifier (or regex heuristic engine) labels them. For scientific papers, we map generic headers to a standardized schema:

* "Materials and Methods", "Experimental Setup" $\\rightarrow$ **Tag: METHODOLOGY**  
* "Discussion", "Interpretation" $\\rightarrow$ **Tag: ANALYSIS**  
* "Bibliography", "Works Cited" $\\rightarrow$ **Tag: REFERENCES**

**Wow Factor:** This allows for "Cross-Document Querying." A user can ask the system to "Show me the Methodology sections of all selected PDFs." The system retrieves the text tagged METHODOLOGY from 20 different files, presenting them side-by-side in an Obsidian Canvas for comparative analysis.10

### **2.3 Figure and Table Extraction**

Figures and tables carry a high density of information but are often locked within the PDF stream. Extracting them requires distinguishing between vector graphics, raster images, and text grids.

#### **2.3.1 Vector vs. Raster Extraction**

PDFs render images in two ways:

1. **Raster Images (Do Operator):** These are embedded bitmaps (JPEG, PNG). MuPDF allows direct extraction of these objects.11  
2. **Vector Graphics:** Charts and diagrams are often drawn using thousands of primitive path commands (re for rectangles, c for curveto). Standard "image extraction" fails here because there is no image file to extract.

The Bounding Box Heuristic:  
To capture vector figures, the system scans the Display List for clusters of drawing commands bounded by whitespace.

1. **Cluster Detection:** We look for high densities of path operators within a defined rectangular region.  
2. **Caption Association:** We scan for text blocks immediately below (for figures) or above (for tables) these regions. If a text block matches ^Fig(ure)?\\.?\\s\*\\d+ or ^Table\\s\*\\d+, it is associated with the graphic.12  
3. **Rasterization:** Once the bounding box (Graphic \+ Caption) is defined, the system uses MuPDF to render *only that specific region* at high DPI (e.g., 300\) to a PNG file. This effectively "snapshots" the vector art into a portable image file.13

#### **2.3.2 Table Structure Recognition**

Tables are fundamentally different; they are grids of text. Treating them as images destroys their utility. We employ a **Whitespace River Detection** algorithm.

1. **Vertical Rivers:** By analyzing the horizontal position of text spans across multiple consecutive lines, the system identifies consistent vertical gaps (rivers) that denote column boundaries.  
2. **Row Baselines:** Horizontal alignment defines rows.  
3. **Reconstruction:** The intersections of Rows and Columns define cells. The system reconstructs this grid into a Markdown table or CSV format. This allows the user to copy the *data* directly into Obsidian or Excel, rather than just an image of the data.13

## ---

**3\. Reading Intelligence: The Quantified Mind**

"Amnesia" is a failure of retention. To cure it, the system must track not just what is in the document, but how the user interacts with it. **Reading Intelligence** involves monitoring user behavior to infer engagement, comprehension, and cognitive load.

### **3.1 Virtual Gaze Tracking via Mouse Heuristics**

True eye-tracking requires specialized hardware or invasive webcam access. However, HCI research 15 demonstrates a strong correlation between cursor position and visual attention during active information seeking tasks.

The Mouse-Scroll-Dwell (MSD) Model:  
We implement a VirtualGaze engine that triangulates attention based on three signals:

1. **Mouse Hover:** In active reading, the mouse often trails the eye (a "reading guide") or hovers in the margin near the current line.  
2. **Text Selection (Fidgeting):** Users frequently highlight text they are reading without intent to copy—a behavior known as "text tracing."  
3. **Scroll Velocity:** The rate of text passage through the viewport.

The Algorithm:  
The viewport is divided into a semantic grid corresponding to the text blocks.

* Every 100ms, the system samples the cursor position ($x, y$) and scroll state.  
* If $Velocity\_{scroll} \\approx 0$ (Dwell) and the cursor is over Block $B$, we increment the AttentionScore of $B$.  
* If $Velocity\_{scroll}$ is consistent with reading speed (approx. 200-300 wpm normalized for viewport height), we uniformly distribute AttentionScore across the text visible in the central 50% of the viewport.  
* **Decay:** Attention scores decay over time to prioritize recent focus.

### **3.2 Cognitive Load Detection via Regressive Saccades**

In oculomotor research, a "regressive saccade" is the rapid backward movement of the eye to re-read difficult text. In a scrolling interface, this manifests as a specific **Oscillation Pattern**.

Heuristic Detection:  
The system monitors the first derivative of scroll position ($\\frac{dy}{dt}$).

* **Pattern:** A rapid "Scroll Down" followed immediately ($t \< 2s$) by a "Scroll Up" of similar magnitude, followed by a pause.  
* **Interpretation:** This signals that the user encountered a concept, failed to process it, and returned to re-read.  
* **Correlation:** We correlate this behavior with the **Lexical Complexity** of the text in view (measured via Flesch-Kincaid or simple syllable count).  
  * *High Complexity \+ Oscillation* \= **Confusion/High Cognitive Load**.  
  * *Low Complexity \+ Oscillation* \= **Distraction/Navigation**.

Visual Feedback \- The Confusion Heatmap:  
When High Cognitive Load is detected, the system updates a local heatmap. This is visualized on the scrollbar as a "hot zone" (red/orange). The user can later review these zones to see where they struggled. Furthermore, this triggers the "Doc Doctor" AI to proactively offer assistance: "This paragraph appears complex. Would you like a simplification?".18

### **3.3 The Active "Readometer"**

Traditional progress bars are deceptive; scrolling to the end does not mean reading. "Amnesia" implements a **Semantic Progress Metric**.

Implementation:  
We utilize the Intersection Observer API 20 to track the visibility of specific text blocks.

* **Rule:** A block is marked "Read" only if it has remained in the "Focus Zone" (center viewport) for a duration $t \> \\frac{WordCount}{ReadingSpeed\_{avg}}$.  
* **State Storage:** This state is persisted in a local **IndexedDB** or **SQLite** database (via sqlite3 in Electron 21), keyed by the file hash.  
* **Visualization:** The scrollbar is replaced by a "Reading Density" rail.22  
  * *White:* Unseen.  
  * *Light Blue:* Skimmed (passed too fast).  
  * *Deep Blue:* Read (met time threshold).  
  * *Gold:* Studied (high dwell time \+ annotations).

This granular visualization combats "Amnesia" by showing the user exactly what they *haven't* processed yet, preventing the illusion of competence.

## ---

**4\. Cross-Document Intelligence: Networked Knowledge**

To cure "Structural Entropy," the system must treat the Obsidian vault not as a folder of files, but as a graph of ideas. **Cross-Document Intelligence** automates the connection of the current document to the wider knowledge base.

### **4.1 Citation Graph Generation (The "Spider" Module)**

Academic knowledge is a lineage. "Amnesia" visualizes this lineage locally.

**Technical Architecture:**

1. **Extraction:** We employ a two-tiered approach.  
   * **Tier 1 (Fast):** Regex-based parsing using libraries like citation.js or anystyle logic ported to JS.23 This works well for structured bibliographies.  
   * **Tier 2 (Robust):** A local instance of **GROBID**.24 While traditionally a server-side Java application, lightweight versions or Docker sidecars can be integrated. GROBID parses the PDF structure to extract citation contexts with high fidelity.  
2. **Resolution:** The system normalizes extracted references (Title, Author, Year). It then queries the Obsidian metadataCache for matching notes.  
   * *Match:* A hard link \] is established.  
   * *No Match:* A **"Ghost Node"** is created. This represents a paper that is cited but not yet in the user's library.  
3. **Visualization:** Using **Cytoscape.js** 26 or **Ogma** 27, we render a local citation graph. The current paper is the central node.  
   * **In-Degree:** Arrows pointing *to* the center represent papers in the vault that cite the current document (Backward Chaining).  
   * **Out-Degree:** Arrows pointing *away* represent the bibliography (Forward Chaining).  
   * **Color Coding:** Green nodes exist in the vault; Grey nodes are "Ghost Nodes" (Knowledge Gaps).28

### **4.2 Semantic Diffs and Concept Drift**

Standard diff tools (git diff) track character changes. "Doc Doctor" tracks **Meaning**. This is vital when reviewing updated drafts or different versions of a standard.

**The Semantic Diff Algorithm:**

1. **Chunking:** The system segments both Document A (old) and Document B (new) into paragraphs.  
2. **Embedding:** Using a local embedding model (e.g., Xenova/all-MiniLM-L6-v2 via transformers.js), we generate vector representations for each chunk.30  
3. **Vector Comparison:** We compute the **Cosine Similarity** between corresponding chunks.  
4. **Drift Detection:**  
   * **High Similarity (\> 0.98):** Identical (or minor punctuation changes).  
   * **Medium Similarity (0.8 \- 0.95):** Rephrasing. Same meaning, different words.  
   * **Low Similarity (\< 0.8):** **Semantic Shift**. The meaning has changed significantly.  
5. **Visualization:** The UI highlights these "Low Similarity" regions. This filters out the noise of copy-editing and focuses the user's attention purely on *conceptual changes*.31

### **4.3 Auto-Linking via Named Entity Recognition (NER)**

Manual linking is the bottleneck of knowledge management. The "Ghost Linker" automates this.

Local NER Pipeline:  
We utilize a quantized BERT model (e.g., Xenova/bert-base-NER) running locally via WebGPU.3

1. **Scan:** As text enters the viewport, it is passed to the NER model.  
2. **Extraction:** The model identifies entities: PER (Persons), ORG (Organizations), LOC (Locations), and MISC (Concepts).  
3. **Fuzzy Matching:** These entities are matched against the Obsidian vault's file list and aliases.  
4. **Overlay:** The system renders **"Ghost Links"**—subtle, clickable overlays on the PDF text. These look like Obsidian links (\[\[...\]\]) but are ephemeral. Clicking one opens the corresponding note.  
5. **Reification:** The user can right-click to "solidify" a Ghost Link, permanently adding it to the annotation layer. This feature turns every static PDF into a potential Wiki, deeply integrated with the user's existing knowledge.34

## ---

**5\. AI-Powered Features: The "Secret Sauce"**

This category leverages the reasoning capabilities of **Anthropic's Claude** (via API) and local LLMs to provide active cognitive support.

### **5.1 The Adversarial Reading Agent (Fallacy Detection)**

Most AI tools summarize; "Doc Doctor" critiques. It employs an **Adversarial Agent** to detect logical flaws.

Chain of Verification Architecture:  
When the user highlights an argument, the system constructs a multi-step prompt 19:

1. **Extraction:** "Extract the core claim and its supporting premises from the selection."  
2. **Taxonomy Check:** "Evaluate the reasoning against the following fallacies: Ad Hominem, Straw Man, False Dichotomy, Circular Reasoning, Correlation/Causation Fallacy."  
3. **Evidence Verification:** "Does the text provide empirical evidence for the premises? Identify any unsupported assertions."  
4. **Output:** A structured JSON object containing the fallacy type, confidence score, and explanation.

**UI:** A "Warning" icon appears in the margin. Hovering over it reveals the critique: *"Potential Straw Man Argument: The author simplifies the opposing view in paragraph 3 before refuting it."* This acts as an automated logic tutor.37

### **5.2 Local RAG (Retrieval-Augmented Generation)**

For privacy and speed, we implement a **Local RAG** system. The data does not leave the machine until the final query is sent to the LLM.

**The Stack:**

* **Database:** **LanceDB**.38 Unlike Pinecone or Weaviate, LanceDB is an embedded, serverless vector database that runs in-process. It stores vectors on disk (using the Lance columnar format), allowing it to scale to millions of embeddings with minimal RAM footprint—crucial for a desktop app.39  
* **Embeddings:** **Transformers.js** running a quantized model (e.g., supbase/gte-small q4) locally via WebGPU.  
* **Orchestration:** **LangChain.js** manages the document chunking and retrieval pipeline.40

**Workflow:**

1. **Ingestion:** When a PDF is added to "Amnesia," text is extracted via MuPDF, chunked (e.g., 500 tokens with 50 overlap), embedded locally, and indexed in LanceDB.  
2. **Query:** The user asks, *"What does this paper say about transformer efficiency?"*  
3. **Retrieval:** LanceDB performs a vector similarity search to find the top-k relevant chunks.  
4. **Synthesis:** The chunks \+ query are sent to Anthropic's Claude 3.5 Sonnet to generate the answer.  
5. **Attribution:** The answer includes citations \`\` that are deep links to the specific PDF coordinates of the source chunk.41

### **5.3 Automated Claim Verification**

This feature automates scientific skepticism.  
Prompt Strategy:  
"Identify all empirical claims in this section. For each claim, check if it is supported by a citation or data. If a claim is made without support, flag it as 'Unsupported'."  
The system overlays a "Truth Table" on the document, color-coding claims based on their evidentiary support. This forces the user to critically evaluate the strength of the argument.42

## ---

**6\. Advanced PDF/EPUB Manipulation: The Engine Room**

To support these high-level features, the system requires low-level control over the document format.

### **6.1 Layout Reconstruction (The "Smart Reflow")**

PDFs are fixed-layout, which is hostile to mobile devices and split-screen multitasking. "Doc Doctor" implements a **Reflow Engine** inspired by k2pdfopt.43

**The Algorithm:**

1. **Block Segmentation:** Using the whitespace detection algorithms (see 2.2), we identify text blocks and image regions.  
2. **Reading Order Linearization:** We sort these blocks based on logical reading order (Top-Left $\\rightarrow$ Bottom-Right for English, handling columns correctly).  
3. **HTML Injection:** Instead of generating a new PDF, we inject the extracted text and images into a responsive HTML container.  
4. **Style Mapping:** We map the original PDF font metrics (size, weight, family) to CSS variables. This preserves the "flavor" of the original typography while allowing fluid resizing and dark mode.44  
5. **Image Anchoring:** Figures are anchored to the nearest paragraph reference (e.g., "see Figure 1") rather than their absolute coordinates, ensuring they stay in context during reflow.

### **6.2 Annotation Standards and Interoperability**

Annotations must not be locked within the application. We adhere to the **W3C Web Annotation Data Model**.

* **Separation of Concerns:** Annotations are stored as a JSON sidecar file (e.g., file.pdf.json) in the Obsidian vault, not embedded in the PDF binary. This prevents file corruption and allows for version control (git) of annotations.  
* **Bi-Directional Sync:** The plugin watches this JSON file. If the user edits the JSON text (e.g., changing "color": "yellow" to "red"), the PDF view updates instantly. Conversely, highlighting in the PDF updates the JSON.  
* **XFDF Support:** For compatibility with external readers (like Acrobat), the system can export/import XFDF (XML Forms Data Format) on demand.46

### **6.3 Repairing Broken PDFs**

Many academic PDFs have corrupted XREF tables or malformed streams. Using **MuPDF's mutool clean** functionality ported to WASM, the system essentially "sanitizes" every document on import.

* **Command:** mutool clean \-gggg.47  
* **Function:** This garbage collects unused objects, reconstructs the XREF table, and linearizes the file, ensuring that the parsing algorithms described in Section 2 receive clean, compliant data.

## ---

**7\. UI/UX Patterns: The Interface of "Active Reading"**

The interface must bridge the gap between "Reader" and "Editor," moving beyond simple scrolling.

### **7.1 Liquid Canvas and "Tear-Out" Excerpts**

Inspired by **LiquidText**, this feature allows users to deconstruct the document.

Technical Implementation:  
We utilize React Portals overlaid on the PDF Canvas.

1. **Selection:** When a user selects text or an image, a "Drag" handle appears.  
2. **Tear-Out:** Dragging this handle instantiates a "Card" component—a React component containing the excerpt.  
3. **Deep Linking:** This Card retains a deep link to the source coordinates (pdf://file.pdf\#page=3\&rect=100,200,300,400).  
4. **Visual Connection:** Using **D3.js** or SVG paths, we render Bezier curves connecting the Card to its source in the document. These curves update dynamically as the user scrolls, maintaining the visual lineage of the idea.48

### **7.2 The Semantic Scrollbar (Heatmap Rail)**

The vertical scrollbar is repurposed as a **Data Visualization Rail**.

* **Visuals:** A 20px wide canvas on the right edge.  
* **Layers:**  
  * *Layer 1 (Heatmap):* Reading density (Blue gradient).  
  * *Layer 2 (Structure):* Colored bands representing sections (Intro, Methods, Results) derived from the Semantic Outline.  
  * *Layer 3 (Search):* Tick marks showing search results or "Ghost Links."  
* **Interaction:** Clicking any point on this rail jumps to that semantic location, not just a pixel offset.22

## ---

**8\. Obsidian Integration Patterns**

The system is designed not as a standalone app, but as a symbiotic organ of Obsidian.

### **8.1 The "Virtual File" Proxy and Dataview Integration**

Obsidian's ecosystem revolves around Markdown. To allow plugins like **Dataview** to interact with PDFs, "Amnesia" implements a **Virtual File Proxy**.

Mechanism:  
For every Paper.pdf, the plugin registers a virtual Paper.md in Obsidian's internal metadata cache. This virtual file does not exist on disk but is exposed to the API.

* **Content:** It contains the extracted text of the PDF.  
* **Frontmatter:** It contains the metadata (Authors, Year, DOI, Readometer Score, Fallacy Count).

Use Case:  
A user can write a Dataview query:

SQL

TABLE read\-score, authors, fallacy\-count  
FROM "Papers"  
WHERE read\-score \> 50 AND contains(file.text, "neural networks")

This works because Dataview queries the *Virtual Proxy*, allowing for SQL-like querying of PDF contents.49

### **8.2 Inter-Plugin Communication (IPC)**

"Amnesia" acts as a platform. It exposes a global API (app.plugins.plugins\['amnesia'\].api) and an event bus.

* **Events:** on-highlight, on-read-progress, on-citation-found.  
* **Integration:** Other plugins (e.g., Spaced Repetition) can listen to these events. For example, highlighting a definition in a PDF could automatically trigger a flashcard creation in the "Spaced Repetition" plugin.51

### **8.3 Graph View Injection**

We patch Obsidian's Graph View renderer to visualize "Ghost Nodes."

* **Hook:** We intercept the getNodes method of the graph renderer.  
* **Injection:** We inject node data for citations that do not yet exist as files.  
* **Styling:** These nodes are styled differently (e.g., dashed borders, grey color) to distinguish them from real notes. This allows the user to see the "potential" graph—the knowledge they *could* have if they processed their bibliography.52

## ---

**9\. Deliverable: Feature Specification List**

The following table summarizes the technical specifications for the core "Secret Sauce" features.

| Feature Name | Category | Technical Approach | Plugin Responsibility | Complexity | Wow Factor | Dependencies |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Ghost ToC Generator** | Document Enhancement | **Font Histogram Analysis:** Parse MuPDF stext for font size/weight distributions. Bin floats (0.5pt). Cluster largest fonts as H1/H2. Reconstruct hierarchy stack based on visual weight. | **Structure Parser:** Runs on file load; generates JSON outline. | High | High (Instantly fixes "flat" PDFs) | MuPDF (WASM) |
| **Semantic Figure Extraction** | Document Enhancement | **Vector/Raster Bounding:** Detect Do operators (images) and vector path clusters (re, c). Parse nearby text for "Fig X" regex. Rasterize bbox to PNG @ 300 DPI. | **Asset Manager:** Saves extracted figures to /assets folder. | Very High | High (One-click "Copy Chart to Note") | MuPDF (Display List) |
| **Active Readometer** | Reading Intelligence | **Intersection Observer \+ Timer:** Track viewport dwell time per block. Accumulate only if Velocity matches reading speed. Persist to IndexedDB. | **Analytics Engine:** Logs metrics; visualizations. | Med | Med (Gamifies reading) | InteractionObserver API |
| **Confusion Heatmap** | Reading Intelligence | **Regressive Saccade Heuristic:** Detect "Up-Down" scroll oscillation patterns ($dy/dt$ flip). Correlate with text complexity (Flesch-Kincaid). | **UI Overlay:** Renders heatmap on scroll rail. | High | High ("It knows I'm confused") | NLP Library (Natural) |
| **The Spider (Citation Graph)** | Cross-Doc Intel | **Local Parsing (GROBID/Regex):** Extract bibliography. Query Vault for matches. Build graph of Found vs. Ghost nodes. Render via Cytoscape.js. | **Graph Engine:** Renders local node graph in sidebar. | Very High | Very High (Visualizes "Knowledge Debt") | Cytoscape.js, GROBID |
| **Semantic Drift Diff** | Cross-Doc Intel | **Vector Embedding Comparison:** Chunk versions \-\> Embed (Transformers.js) \-\> Cosine Similarity. Highlight segments with similarity \< 0.8. | **Diff Viewer:** Visualizes meaning change vs. text change. | High | High (Reviewing revisions instantly) | Transformers.js, LanceDB |
| **Ghost Linker (NER)** | Cross-Doc Intel | **Local BERT-NER:** Run quantized BERT via WebGPU on viewport text. Fuzzy match entities against app.metadataCache. Render overlay links. | **Linker Service:** Bridges PDF text to Obsidian Vault. | High | Very High (Turns PDF into Wiki) | Transformers.js (WebGPU) |
| **Adversarial Agent** | AI-Powered | **Chain of Verification:** Prompt: "Extract claim \-\> Identify premises \-\> Check Fallacy \-\> Output JSON." | **AI Broker:** Manages Anthropic API calls. | Med | High (Automated skepticism) | Anthropic API |
| **Local RAG Oracle** | AI-Powered | **Embedded Vector Search:** Index chunks to LanceDB (local disk). Hybrid search (Keyword \+ Vector) for answers. | **Search Engine:** Orchestrates Retrieval \+ Generation. | Very High | High (Chat with privacy) | LanceDB, LangChain.js |
| **Liquid Canvas** | UI/UX | **React Portal Overlay:** Allow text/image selection to be "torn off" into floating Cards. Link cards via SVG bezier curves. | **View Layer:** Manages overlay DOM & coordinates. | High | Very High (LiquidText experience) | React, D3.js |
| **Smart Reflow** | PDF Manipulation | **Block Segmentation (XY-Cut):** Detect columns. Linearize reading order. Inject text into HTML container with CSS variables mapped from PDF fonts. | **Viewer UI:** Toggles between "Fixed" and "Reflow". | High | Med (Mobile/Split-screen readability) | k2pdfopt (logic) |
| **Dataview Proxy** | Obsidian Integration | **Virtual File System:** Expose PDF text/metadata as a virtual .md file to Obsidian's internal cache API. | **API Bridge:** Allows Dataview to query PDF contents. | Very High | Med (Power user feature) | Obsidian Internal API |

## **10\. Conclusion**

The "Amnesia \+ Doc Doctor" system represents a fundamental reimagining of the PDF viewer. By moving from **passive pixel rendering** to **active semantic reconstruction**, it addresses the root causes of Document Amnesia and Structural Entropy. The architecture defined here—Local-First, Vector-Native, and Deeply Integrated—combines the low-level precision of MuPDF with the reasoning capabilities of LLMs and the structural rigor of Graph Theory. It transforms the PDF from a digital dead-end into a vibrant, connected node in the user's knowledge graph, setting a new standard for intelligent research environments.

#### **Obras citadas**

1. Font \- MuPDF.NET documentation, fecha de acceso: enero 8, 2026, [https://mupdfnet.readthedocs.io/en/latest/classes/Font.html](https://mupdfnet.readthedocs.io/en/latest/classes/Font.html)  
2. mupdf/CHANGES at master \- GitHub, fecha de acceso: enero 8, 2026, [https://github.com/ArtifexSoftware/mupdf/blob/master/CHANGES](https://github.com/ArtifexSoftware/mupdf/blob/master/CHANGES)  
3. Transformers.js: Building Next-Generation WebAI Applications, fecha de acceso: enero 8, 2026, [https://www.youtube.com/watch?v=gJMiWw\_5-us](https://www.youtube.com/watch?v=gJMiWw_5-us)  
4. Excited about WebGPU \+ transformers.js (v3): utilize your full (GPU ..., fecha de acceso: enero 8, 2026, [https://www.reddit.com/r/LocalLLaMA/comments/1fexeoc/excited\_about\_webgpu\_transformersjs\_v3\_utilize/](https://www.reddit.com/r/LocalLLaMA/comments/1fexeoc/excited_about_webgpu_transformersjs_v3_utilize/)  
5. Algorithms to Extract Text From a PDF (re-flowing text layout from a ..., fecha de acceso: enero 8, 2026, [https://stackoverflow.com/questions/27549574/algorithms-to-extract-text-from-a-pdf-re-flowing-text-layout-from-a-jumble-of-w](https://stackoverflow.com/questions/27549574/algorithms-to-extract-text-from-a-pdf-re-flowing-text-layout-from-a-jumble-of-w)  
6. Font \- PyMuPDF documentation, fecha de acceso: enero 8, 2026, [https://pymupdf.readthedocs.io/en/latest/font.html](https://pymupdf.readthedocs.io/en/latest/font.html)  
7. Text \- PyMuPDF documentation, fecha de acceso: enero 8, 2026, [https://pymupdf.readthedocs.io/en/latest/recipes-text.html](https://pymupdf.readthedocs.io/en/latest/recipes-text.html)  
8. Daniel@FinTOC'2 Shared Task: Title Detection and Structure ..., fecha de acceso: enero 8, 2026, [https://aclanthology.org/2020.fnp-1.30.pdf](https://aclanthology.org/2020.fnp-1.30.pdf)  
9. HiPS: Hierarchical PDF Segmentation of Textbooks \- arXiv, fecha de acceso: enero 8, 2026, [https://arxiv.org/html/2509.00909v1](https://arxiv.org/html/2509.00909v1)  
10. All graph-view Obsidian Plugins., fecha de acceso: enero 8, 2026, [https://www.obsidianstats.com/tags/graph-view](https://www.obsidianstats.com/tags/graph-view)  
11. The Basics \- PyMuPDF documentation, fecha de acceso: enero 8, 2026, [https://pymupdf.readthedocs.io/en/latest/the-basics.html](https://pymupdf.readthedocs.io/en/latest/the-basics.html)  
12. A process to find and extract data-points from graphs in pdf files, fecha de acceso: enero 8, 2026, [https://shape-of-code.com/2025/07/27/a-process-to-find-and-extract-data-points-from-graphs-in-pdf-files/](https://shape-of-code.com/2025/07/27/a-process-to-find-and-extract-data-points-from-graphs-in-pdf-files/)  
13. How to extract text from a PDF using PyMuPDF and Python, fecha de acceso: enero 8, 2026, [https://www.nutrient.io/blog/extract-text-from-pdf-pymupdf/](https://www.nutrient.io/blog/extract-text-from-pdf-pymupdf/)  
14. Extracting Text from Multi-Column Pages: A Practical PyMuPDF Guide, fecha de acceso: enero 8, 2026, [https://artifex.com/blog/extracting-text-from-multi-column-pages-a-practical-pymupdf-guide](https://artifex.com/blog/extracting-text-from-multi-column-pages-a-practical-pymupdf-guide)  
15. Measurement and Modeling of Eye-mouse Behavior in the Presence ..., fecha de acceso: enero 8, 2026, [https://research.google.com/pubs/archive/40760.pdf](https://research.google.com/pubs/archive/40760.pdf)  
16. User see, user point: gaze and cursor alignment in web search, fecha de acceso: enero 8, 2026, [https://scispace.com/pdf/user-see-user-point-gaze-and-cursor-alignment-in-web-search-xkdw1ypedr.pdf](https://scispace.com/pdf/user-see-user-point-gaze-and-cursor-alignment-in-web-search-xkdw1ypedr.pdf)  
17. User See, User Point: Gaze and Cursor Alignment in Web Search, fecha de acceso: enero 8, 2026, [https://jeffhuang.com/papers/GazeCursor\_CHI12.pdf](https://jeffhuang.com/papers/GazeCursor_CHI12.pdf)  
18. John Bean. "Helping Students Read Difficult Texts." Engaging Ideas, fecha de acceso: enero 8, 2026, [https://americancultures.berkeley.edu/sites/default/files/5.\_helping\_students\_read\_difficult\_texts\_by\_john\_bean.pdf](https://americancultures.berkeley.edu/sites/default/files/5._helping_students_read_difficult_texts_by_john_bean.pdf)  
19. How to Detect and Correct Logical Fallacies from GenAI Models \- Zilliz, fecha de acceso: enero 8, 2026, [https://zilliz.com/blog/how-to-detect-and-correct-logical-fallacies-from-genai-models](https://zilliz.com/blog/how-to-detect-and-correct-logical-fallacies-from-genai-models)  
20. Scroll Events and Intersection Observer \- Wes Bos, fecha de acceso: enero 8, 2026, [https://wesbos.com/javascript/06-serious-practice-exercises/scroll-events-and-intersection-observer](https://wesbos.com/javascript/06-serious-practice-exercises/scroll-events-and-intersection-observer)  
21. How to Use Retrieval-Augmented Generation (RAG) Locally \- DZone, fecha de acceso: enero 8, 2026, [https://dzone.com/articles/how-to-use-rag-locally](https://dzone.com/articles/how-to-use-rag-locally)  
22. Heatmap Explorer: an interactive gaze data visualization tool for the ..., fecha de acceso: enero 8, 2026, [https://latin.ime.usp.br/media/papers/pdf/heatmap-explorer.pdf](https://latin.ime.usp.br/media/papers/pdf/heatmap-explorer.pdf)  
23. AnyStyle.io, fecha de acceso: enero 8, 2026, [https://anystyle.io/](https://anystyle.io/)  
24. GROBID: combining automatic bibliographic data recognition and ..., fecha de acceso: enero 8, 2026, [https://scispace.com/pdf/grobid-combining-automatic-bibliographic-data-recognition-1d8u4p2crn.pdf](https://scispace.com/pdf/grobid-combining-automatic-bibliographic-data-recognition-1d8u4p2crn.pdf)  
25. allenai/spp-grobid: A machine learning software for ... \- GitHub, fecha de acceso: enero 8, 2026, [https://github.com/allenai/spp-grobid](https://github.com/allenai/spp-grobid)  
26. Cytoscape.js, fecha de acceso: enero 8, 2026, [https://js.cytoscape.org/](https://js.cytoscape.org/)  
27. Top 10 JavaScript Libraries for Knowledge Graph Visualization \- Focal, fecha de acceso: enero 8, 2026, [https://www.getfocal.co/post/top-10-javascript-libraries-for-knowledge-graph-visualization](https://www.getfocal.co/post/top-10-javascript-libraries-for-knowledge-graph-visualization)  
28. A Tool for Automatically Generating Citation Graphs and Variants, fecha de acceso: enero 8, 2026, [https://www.researchgate.net/publication/347211798\_ReViz\_A\_Tool\_for\_Automatically\_Generating\_Citation\_Graphs\_and\_Variants](https://www.researchgate.net/publication/347211798_ReViz_A_Tool_for_Automatically_Generating_Citation_Graphs_and_Variants)  
29. FZJ-IEK3-VSA/citation-graph-builder \- GitHub, fecha de acceso: enero 8, 2026, [https://github.com/FZJ-IEK3-VSA/citation-graph-builder](https://github.com/FZJ-IEK3-VSA/citation-graph-builder)  
30. Transformers.js \- Hugging Face, fecha de acceso: enero 8, 2026, [https://huggingface.co/docs/transformers.js/index](https://huggingface.co/docs/transformers.js/index)  
31. SEMANTIC DIFFERENCES AND GRAPHICAL VIEW OF FILES, fecha de acceso: enero 8, 2026, [https://www.diva-portal.org/smash/get/diva2:210981/FULLTEXT01.pdf](https://www.diva-portal.org/smash/get/diva2:210981/FULLTEXT01.pdf)  
32. Identifying the semantic and textual differences between two ..., fecha de acceso: enero 8, 2026, [https://scispace.com/pdf/identifying-the-semantic-and-textual-differences-between-two-5bcyp5rvoe.pdf](https://scispace.com/pdf/identifying-the-semantic-and-textual-differences-between-two-5bcyp5rvoe.pdf)  
33. (PDF) Concept drift detection and visualization with shifting window, fecha de acceso: enero 8, 2026, [https://www.researchgate.net/publication/395191882\_Concept\_drift\_detection\_and\_visualization\_with\_shifting\_window](https://www.researchgate.net/publication/395191882_Concept_drift_detection_and_visualization_with_shifting_window)  
34. Streaming Cross Document Entity Coreference Resolution, fecha de acceso: enero 8, 2026, [https://aclanthology.org/C10-2121.pdf](https://aclanthology.org/C10-2121.pdf)  
35. Intelligent Document Search with AI | Products, fecha de acceso: enero 8, 2026, [https://docs.ionos.com/cloud/ai/ai-model-hub/how-tos/semantic-file-search](https://docs.ionos.com/cloud/ai/ai-model-hub/how-tos/semantic-file-search)  
36. Large Language Models Are Better Logical Fallacy Reasoners with ..., fecha de acceso: enero 8, 2026, [https://aclanthology.org/2025.findings-naacl.384.pdf](https://aclanthology.org/2025.findings-naacl.384.pdf)  
37. Boosting Logical Fallacy Reasoning in LLMs via Logical Structure ..., fecha de acceso: enero 8, 2026, [https://people.engr.tamu.edu/huangrh/papers/emnlp24-main.fallacy-reasoning.pdf](https://people.engr.tamu.edu/huangrh/papers/emnlp24-main.fallacy-reasoning.pdf)  
38. AnythingLLM's Competitive Edge: LanceDB for Seamless RAG and ..., fecha de acceso: enero 8, 2026, [https://lancedb.com/blog/anythingllms-competitive-edge-lancedb-for-seamless-rag-and-agent-workflows/](https://lancedb.com/blog/anythingllms-competitive-edge-lancedb-for-seamless-rag-and-agent-workflows/)  
39. Benchmarking LanceDB. How to optimize recall vs latency for…, fecha de acceso: enero 8, 2026, [https://medium.com/etoai/benchmarking-lancedb-92b01032874a](https://medium.com/etoai/benchmarking-lancedb-92b01032874a)  
40. Implementing RAG (Retrieval-Augmented Generation): A Guide, fecha de acceso: enero 8, 2026, [https://itnext.io/implementing-rag-retrieval-augmented-generation-a-guide-9e659f755d0b](https://itnext.io/implementing-rag-retrieval-augmented-generation-a-guide-9e659f755d0b)  
41. Elicit: AI for scientific research, fecha de acceso: enero 8, 2026, [https://elicit.com/](https://elicit.com/)  
42. Multi-LLM Agents Architecture for Claim Verification \- CEUR-WS.org, fecha de acceso: enero 8, 2026, [https://ceur-ws.org/Vol-3962/paper20.pdf](https://ceur-ws.org/Vol-3962/paper20.pdf)  
43. K2pdfopt \- PDF Reflow tool \- Ubuntu Manpage, fecha de acceso: enero 8, 2026, [https://manpages.ubuntu.com/manpages/jammy/man1/k2pdfopt.1.html](https://manpages.ubuntu.com/manpages/jammy/man1/k2pdfopt.1.html)  
44. Oh Snap\! Startling Discoveries When You Reflow Your PDF \- MN.gov, fecha de acceso: enero 8, 2026, [https://mn.gov/mnit/media/blog/?id=38-584554](https://mn.gov/mnit/media/blog/?id=38-584554)  
45. PDF Reflow \- App Store \- Apple, fecha de acceso: enero 8, 2026, [https://apps.apple.com/gb/app/pdf-reflow/id1461144444](https://apps.apple.com/gb/app/pdf-reflow/id1461144444)  
46. Active Reading for Lawyers \- LiquidText, fecha de acceso: enero 8, 2026, [https://www.liquidtext.net/active-reading](https://www.liquidtext.net/active-reading)  
47. mutool clean \- MuPDF 1.26.6, fecha de acceso: enero 8, 2026, [https://mupdf.readthedocs.io/en/1.26.6/tools/mutool-clean.html](https://mupdf.readthedocs.io/en/1.26.6/tools/mutool-clean.html)  
48. LiquidText 3.0: A Uniquely Digital PDF Experience \- MacStories, fecha de acceso: enero 8, 2026, [https://www.macstories.net/ios/liquidtext-3-0-a-uniquely-digital-pdf-experience/](https://www.macstories.net/ios/liquidtext-3-0-a-uniquely-digital-pdf-experience/)  
49. Run \- Generate markdown from dataview query and javascript., fecha de acceso: enero 8, 2026, [https://www.obsidianstats.com/plugins/run](https://www.obsidianstats.com/plugins/run)  
50. Obsidian Run \- powerful plugin to generate markdown from javascript, fecha de acceso: enero 8, 2026, [https://www.reddit.com/r/ObsidianMD/comments/16ybtlz/obsidian\_run\_powerful\_plugin\_to\_generate\_markdown/](https://www.reddit.com/r/ObsidianMD/comments/16ybtlz/obsidian_run_powerful_plugin_to_generate_markdown/)  
51. Inter-plugin Communication (Expose API to Other Plugins), fecha de acceso: enero 8, 2026, [https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618](https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618)  
52. Graph view \- Obsidian Help, fecha de acceso: enero 8, 2026, [https://help.obsidian.md/plugins/graph](https://help.obsidian.md/plugins/graph)