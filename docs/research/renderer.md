High-Performance Paginated EPUB Rendering (60fps Target) — Electron + iPadOS
The core challenge is achieving smooth, 60 fps horizontal paging with a reflowable EPUB, under constraints (dynamic font sizes, keyboard nav, selectable text) in two environments: Desktop (Electron/Chromium) and iPadOS (WKWebView/WebKit). Below we compare DOM-based pagination strategies, virtualization, scrolling vs transform animations, layering optimizations, and other approaches (canvas, lazy loading, dual-platform strategy), with concrete patterns and pitfalls. Wherever possible we cite industry guidance (Readium, CSS spec blogs) and profiling findings.

1. Pagination Models (DOM-Based)
Approaches: The common models are:

CSS Multi-Column (single-scrolling page): All content (or each chapter) is one wide container using column-width/column-count, and page turns by shifting the container (via scrollLeft or transform). Example: current implementation.
CSS Scroll-Snap (page-per-container): Wrap each “page” or chapter in a fixed-size element (width=viewport) and use overflow-x: scroll; scroll-snap-type: x mandatory; so the browser naturally snaps to pages.
Manual Translate: Calculate a pageIndex and set container.style.transform = translate3d(-pageIndex*pageWidth,0,0) on the content element. This is similar to multi-column but offsets in JS.
Paged-WebKit (deprecated): The CSS Paged Media feature (overflow: -webkit-paged-x) was an experimental way to paginate, but it is not supported on Chromium and being removed[1].
Comparison:

Strategy
Desktop (Chromium)
iPad (WKWebView/WebKit)
CSS Columns
Works (Chrome fully supports columns). Layout cost is high if DOM is large – a very wide scrollWidth (~80k–300k px) forces complex reflows. GPU composite animation via transform is possible[2] but not automatic.
Supported. Common technique on iOS: set body {column-width: viewWidth; height: viewHeight;} and enable the scroll view’s paging[3]. Splits text into viewport-sized pages. Still heavy if content is huge, but native paging yields momentum.
Scroll-Snap Container
Fully supported: define a flex container of page elements with overflow-x: auto; scroll-snap-type: x mandatory;. Browser handles momentum and snap alignment. DOM size can be kept small (one page per element). Works smoothly if page elements are lightweight.
Supported in modern WebKit (iOS 13+). Provides native touch/gesture-based snap with hardware acceleration. One can rely on native momentum. Easier to implement paging with no JS animation.
Translate3d (manual)
Browser-composed transform; if will-change: transform is used, this often triggers a composite layer for smooth GPU animation[2]. But JS must handle drag/momentum manually on desktop (trackpad events produce discrete deltas, not natural inertia).
Possible, but not necessary: iPad has built-in touch momentum. Manually animating transform with requestAnimationFrame is complex on touch (better use native scroll).
Overflow: -webkit-paged-x
Not supported in Chromium (planned removal[1]).
Undocumented/obsolete even on WebKit. Not reliable for production.
Page Containers (DOM pages)
Break chapters or fixed page blocks into separate <div>s (width=viewport) inside a scrollable parent. This hybrid of scroll-snap or transform allows keeping each page as an isolated subtree. Requires computing page breaks manually or via CSS columns per-page. In desktop Chrome, gives fine control and smaller DOM per page.
Same idea: each chapter/page in its own <div>. You can still use columns within each div for multi-column chapters. Combined with scrollView.isPagingEnabled or CSS snap, this yields per-page pagination. Helps virtualization (see below).
Industry Practices: Readium (R2) historically used CSS columns for web readers and notes that the (non-standard) -webkit-paged-x can “perform much better” than columns[4]. In fact, NYPL’s Readium team said they use columns on desktop web (for broad compatibility) but plan to use paged-x on mobile for performance, since mobile GPUs/CPUs are weaker[5]. Another Readium team (EPUBPurifier) noted columns are the conservative choice (preferring one consistent strategy) until paged-x matures[6]. In our case, paged-x isn’t an option, so columns or scroll-snap are the fallback. Ahmed’s WKWebView guide confirms CSS columns + native iOS paging is a workable solution[3].

Pitfalls & Tips: - Large DOM: A single-tree column layout means thousands of DOM nodes/ text fragments. Every reflow (e.g. on font-size change) is costly. - Predictability: CSS columns break at word boundaries automatically, which is good, but can interact poorly with images or floats (Readium warns paged-x might handle complex layouts differently than columns[6]). - RTL Support: CSS columns + transform may need manual mirroring (Ahmed’s guide uses CSS direction: rtl or transform scale trick[7]). With scroll-snap, setting direction: rtl on the container can flip paging. - Focus/Selection: Multi-column text still selects normally, but if using overflow-x on inner divs, ensure focus moves between page-containers properly.

Implementation Pattern (pseudocode): For example, using scroll-snap:

/* CSS for container and pages */
#viewer { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; }
.page { flex: 0 0 100%; scroll-snap-align: start; }

// Populate container with pages (each 100vw). No JS needed for animation; let user scroll or call:
viewerEl.scrollTo({ left: pageIndex * viewerWidth, behavior: 'smooth' });

For transform-based:

// Assume one wide #content with multi-column layout
const pageWidth = viewerEl.offsetWidth;
function goToPage(i) {
 contentEl.style.transform = `translate3d(${-i*pageWidth}px,0,0)`;
}

Summary: CSS columns are simplest but heavy; page-per-div with scroll-snap is more performant if DOM is kept small. On iPad, leveraging native scrolling/paging (via isPagingEnabled or CSS snap) tends to yield smoother touch interactions. Always test both in Chrome and WKWebView to profile.

2. Virtualization / Windowing
Goal: Keep the live DOM small to reduce layout and paint work. Instead of concatenating all chapters, use windowed rendering (only render pages near the current view).

Limit Pages in DOM: e.g. keep current page plus a few before/after. When user nears an end, append the next page and remove the farthest one. Readium’s guidelines stress limiting “additional resources” to adjacent items to avoid blowing up the DOM or memory[8].
IntersectionObserver: Use IO to detect when the user scrolls close to page boundaries. For example, place empty sentinel divs at the end of a page container; when it enters view, load the next page content. This avoids manual scroll polling. Similarly, unload pages when they go far out of view.
Existing Libraries: Tools like virtual-scroller (lit/web-component) or Clusterize.js assume vertical lists of similar items. They are not directly suited to EPUB (variable heights, horizontal flow). A custom solution is needed, but concepts are the same: estimate content size, replace offscreen items with placeholders.
Page-based Windowing: Another model is “paged windowing”: treat each page (or chapter) as an item of unknown height, and only mount N of them. Compute pages via e.g. CSS columns within each chapter-div. On page-turn, if moving forward, load the next chapter into DOM before animation, and after turning, prune the old chapter behind. This reduces memory usage at the cost of doing layout for that chapter on-demand.
Trade-offs: Virtualization reduces the work per interaction (fewer nodes to style/repaint), which is critical if large fonts or images are present. However, inserting/removing content can itself cause jank if done synchronously. On iPad especially, avoid jank: ensure loading/unloading happens outside of scrolling (e.g. prefetch off-DOM or under a requestAnimationFrame). Also, keep the visual “container” (scrollWidth) updated to prevent jumps.

Recommendations: For an ebook, a simple strategy is: always keep 3-5 pages loaded. For example, when on page 10, ensure pages 8–12 are in the DOM; if the user goes to 11, add 13 and remove 8. This windowed approach has been used successfully in many reader apps. Profiling results often show that DOM count (and reflow cost) grows superlinearly with thousands of elements, so even halving DOM size can help reach 60fps.

“Limit prefetching to adjacent resources…consider frame times, DOM node count, CPU and memory”[8]. This underscores only building the minimal needed pages.
3. Native Scroll vs. Transform Animation
Scroll-Snap / Browser Scroll: Leveraging browser scrolling is often easiest. With CSS scroll-snap, the browser handles inertia and snapping. On iPadOS, native touch scrolling is highly optimized on the compositor thread, giving smooth momentum and 60fps with minimal JS. In Chromium, scroll-behavior: smooth can animate page-to-page in ~300ms. Advantages: - Hardware-accelerated scrolling on most platforms. - Offloads animation to browser (fewer JS frames). - Momentum and bounce feel “native” (especially on touch devices). - Automatic focus moves with scroll (good for accessibility). - However, scrollTo or changing scrollLeft still involves layout recalculations, so jumpy if done too frequently.

Transform Animations: Using element.style.transform = translate3d(...) to move content is also GPU-accelerated when applied to a composited layer. CSS animating transform yields very smooth motion[2]. The downside is that on desktop trackpad you must simulate inertia (because mousewheel events don’t inherently produce eased animation like touch). If you implement drag with JS, you’ll need to handle pointer events, calculate velocity, and animate to a stop (like a decelerating fling). This can be done (libraries like iScroll or custom velocity), but adds complexity.

Performance: Transform animations only repaint the layer and composite, avoiding layout and paint costs. This is ideal: “use transforms (+ opacity) for high performance”[2]. But if the element being transformed contains text or images not already cached on the GPU, you may incur repaints. Ensuring the element is promoted (will-change: transform or using translate3d initially) is key.
Browsers: Some advise that changing scrollLeft can trigger relayout less than toggling transforms, but in practice modern engines optimize both well. It’s important to profile. On Chrome desktop, a single very wide container with translate3d can be fast if kept to one layer. On Safari mobile, -webkit-overflow-scrolling: touch ensures smooth hardware scroll.
Pitfalls: - On Chromium/Electron, trackpad scroll events may jump pages too fast; scroll-snap can be jerky without scroll-behavior due to how Chrome implements wheel. In testing, transform-with-JS can feel smoother if you fine-tune easing. - Remember keyboard nav: Arrow keys or PageUp/Down should move by a page. This is easy with scrollBy(viewWidth) or adjusting transform by pageWidth.

Profiling: Use the browser’s Performance/Tracing tool to see which is smoother. Chrome’s Performance tab and FPS meter can reveal dropped frames. Safari’s Web Inspector has similar timelines. In practice, many devs find that letting the browser handle scroll (especially on iPad) feels better than manually animating every frame in JS.

4. GPU Compositing & Layout Optimization
Smooth 60fps animation requires minimizing repaint/layout work each frame. Techniques:

Layer Promotion: Ensure the moving element is on its own GPU layer. Adding will-change: transform; or transform: translateZ(0) can hint the browser. For example, the page container or current pages can be promoted so that subsequent transforms only require compositing, not layout. (Be cautious: too many layers consume memory.)
CSS Containment: Use contain properties to isolate page subtrees. For instance, contain: layout paint; on a page container tells the browser its children won’t affect outside layout or overflow, so offscreen pages can skip layout. Likewise, content-visibility: auto; contain-intrinsic-size: ...; on offscreen pages can skip their rendering entirely until they intersect the viewport[9]. (Note: content-visibility is relatively new and may not be available on all iPadOS versions yet.)
content-visibility (new CSS): This is a promising tool: content-visibility: auto keeps the element in the accessibility tree but skips painting/layout offscreen. Nolan Lawson notes it “doesn’t affect find-in-page” and requires only a size hint, avoiding full virtualization code[9]. In benchmarks it can dramatically reduce initial load and scroll jank on large lists. For EPUB, if pages are statically sized by CSS, content-visibility could be applied to page containers to skip offscreen layout. Web.dev reports up to 7× faster rendering by chunking content this way[10].
Minimize Expensive CSS: Avoid CSS rules that force layout or paint each frame. For example, avoid animating properties like top/left or triggering visibility toggles. Use simple selectors (ID/class) rather than complex attribute selectors (attribute selectors are 5–10× slower on mobile[11]). Avoid heavy styling (e.g. too many box-shadows or large images).
DevTools Layers Panel: In Chrome DevTools, use the Layers panel to inspect which elements are in separate layers and how textures are allocated. A yellow dot (layer) in the Styles panel shows a promoted layer. If your entire content is one layer, great, but if each word is a layer (unlikely), you’d see trouble. Tools like the Performance panel will show “Composite Layers” steps when animating. Aim for most work in “Composite” rather than “Layout” or “Paint”.
Pitfalls: - Overuse of layers: If you set will-change on too many elements (or very large ones), Chrome will allocate huge textures, hurting memory and possibly reducing speed. Only promote elements you actually animate. - contain/visibility limitations: If applied incorrectly, contain: paint can clip overflowing content. Content-visibility may not support dynamic content changes well (it caches assumed size). Test carefully. - iframe isolation: Our content runs in an iframe for security. Chrome compositing can still promote layers inside an iframe, but measuring overall layers requires profiling the iframe content specifically.

5. Canvas / WebGL Rendering
Rendering EPUB text via Canvas or WebGL (e.g. drawing glyphs manually or via a texture atlas) is theoretically possible but generally impractical for this use case:

Pros: In theory, drawing everything to a Canvas could hit 60fps easily with GPU acceleration (like a game). You could pre-render pages as textures and just shift them.
Cons: Text Selection & Accessibility: Canvas draws pixels; by itself you lose text selection, copying, find-in-page, and screen reader access. You’d have to implement text hit-testing yourself, and overlay HTML for selection, which negates the speed gains. Font Rendering: Canvas text quality (especially at high DPI) can be poor, and dynamic font sizing would require re-rendering entire canvas frequently. Complexity: You’d effectively be building a text layout engine (line breaking, hyphenation, pagination) from scratch in JS/WebGL. Mainstream readers avoid this for reflowable text.
In short, a full Canvas or WebGL solution would break core requirements (selectable text, screen reader support) and is not used in production EPUB readers. A hybrid approach (e.g. render dynamic backgrounds/animations in WebGL while overlaying real text) could be explored, but text itself should remain in DOM for selection. Given the high implementation cost and the prompt’s note that selection is required, we do not recommend pure canvas for text.

6. Chunked / Lazy Rendering
Even without fancy virtual-scrollers, simple lazy strategies can help:

IntersectionObserver: As mentioned, IO can watch for pages entering the near-view area and load them. For example, mark the next page container with an invisible sentinel at 50% width; when it intersects, fetch/render the page content.
Manual Mount/Unmount: Implement logic that explicitly “mounts” a page’s HTML when needed, and later “unmounts” it (removes from DOM) when far away. This trades memory for CPU (unmounting reclaims memory, but remounting forces a re-layout).
Memory vs. FPS (iPad): Mobile devices have stricter memory. On iPadOS, keeping 10+ pages worth of DOM can spike memory (images and text). If you observe the Web Inspector memory snapshot, you may need to cap pages. It might be acceptable to drop more pages on mobile and accept a quick render of reloading them when flipping back. On desktop, you can afford a larger buffer for instant backward/forward nav.
Re-pagination Latency: The prompt notes repagination (on font change) can take up to 500 ms, which is okay. But during this, ensure the UI shows a loading state to avoid jank. On iPad, avoid synchronous offsetWidth loops for reflow if possible; use requestAnimationFrame or offload heavy work (e.g. web worker to parse layout logic, if any).
7. Dual-Renderer Strategy (Desktop vs. iPad)
In practice, one solution may not be ideal on both platforms. It can make sense to diverge strategies:

Desktop (Electron/Chromium): Use a transform-based pager or scroll-snap with larger DOM windows, since Chromium has abundant memory and powerful GPU. For example, keep 5–10 pages in DOM, leverage CSS contain/visibility, and animate with transform: translate3d for precise control. Use keyboard and mouse events. GPU compositing is strong here. Chromium’s performance tools are also more advanced for profiling.
iPad (WKWebView): Emphasize native scrolling. Likely use CSS columns for each chapter and enable scrollView.isPagingEnabled so one finger swipe automatically snaps to pages[3]. Keep very small DOM (maybe only 3–5 pages) due to iPad memory limits. Avoid complex JS animations; rely on WebKit’s touch momentum. Remember touch-specific CSS like -webkit-overflow-scrolling: touch for smooth deceleration. Also test on a real device, as WKWebView (not full Safari) may have some quirks (e.g. no 300ms tap delay, but check memory footprint via Xcode Instruments).
Shared vs. Platform-Specific Logic: The core pagination math and EPUB parsing can be shared TypeScript. But implement two “view engines”: one for Desktop (Chromium-specific code) and one for iPad (WebKit-specific tweaks). For example: - Shared: calculate CFI or spine position → target page index. - Diverge in rendering: Desktop uses a transform, iPad may call webView.scrollView.setContentOffset or adjust scroll-snap position.

What Must Diverge: - Scrolling/paging implementation: as above (native vs JS). - Virtualization thresholds: desktop can preload more chapters; iPad preload fewer. - Layer tricks: content-visibility might be used on desktop only if not available on iOS. - Debugging/Profiling: use Chrome DevTools on desktop; use Safari Web Inspector or iPad Instruments on mobile.

What Can Be Shared: - EPUB parsing, layout measurements (if measured in DOM, results should agree), pagination logic (number of columns/pages given a width). - UI code (Svelte) and event handling can be mostly shared.

 
Recommendations Summary
Based on the above, we suggest:

Desktop (Electron/Chromium): Continue with GPU-backed transforms or scroll-snap. Try a hybrid: wrap each chapter in a page-width <div>, use CSS columns inside, then animate page turns with transform: translate3d on the wrapper. Promote the wrapper layer (will-change) and use contain: paint per page. Virtually mount 5–7 pages. Profiling should show minimal Layout work per frame – mostly composite.
iPad (WKWebView): Use CSS columns + native scroll paging[3]. For example, in the WKWebView delegate, set isPagingEnabled = true and body styles as recommended. Keep pages (or chapters) separate so WebKit only loads adjacent pages. Let the OS handle flick inertia. Test memory: if WKWebView slows, reduce the number of prefetched pages. Disable unnecessary delegate callbacks on the scrollView (we saw one Q/A where hooking scroll events slowed performance[12]).
Virtualization: In both, only render the current ±2 pages; use IntersectionObserver or on-scroll logic to swap in/out DOM. Readium’s advice is to prefetch just previous/next resource[8]; we interpret that as only adjacent pages/chapters.
Metrics & Tools: Always measure with DevTools. Use the Performance timeline to see frame durations. Use the Layers panel to ensure you have composite layers for animations. On slowdowns, look for long “Recalculate Style” or “Layout” tasks: these indicate too much DOM or expensive CSS.
Anti-Patterns: Avoid full-book single-page layouts (as currently), overuse of CSS selectors like [epub|type], avoid heavy repaints (no opacity/layout changes during scroll). Do not overload scrolling delegate callbacks on iPad (that kills native performance[12]). Do not use hidden page buffers with visibility: hidden (still incurs layout costs) – better to remove from DOM entirely.
“Performance is not an afterthought, it’s a main objective.” Optimize early with real profiling, test large books, and adjust. With careful use of CSS containment and windowing, reaching ~60fps is realistic on both Chromium and WebKit.
Sources: We drew on expert discussions and documentation (Readium, Medium blogs) and web standards articles for performance. For example, Readium’s R2 design notes compare CSS columns vs new paged media and advocate limiting prefetch to adjacent content[4][8], and advice from performance specialists urges use of transforms and CSS containment for smooth animation[2][9]. These guided our recommendations.

 
[1] [3] [7] WKWebView Horizontal Paging

https://ahmedk92.github.io/2017/11/03/WKWebView-Horizontal-Paging.html
[2] [11] Let’s talk about eBook performance | by Jiminy Panoz | Medium

https://medium.com/@jiminypan/lets-talk-about-ebook-performance-801b83745ea4
[4] [5] [6] R2 Navigator Design Dilemmas

https://readium.org/technical/r2-navigator-design-dilemmas/
[8] Readium Web | A toolkit for ebooks, audiobooks and comics written in Typescript

https://readium.org/ts-toolkit/
[9] Improving rendering performance with CSS content-visibility | Read the Tea Leaves

https://nolanlawson.com/2024/09/18/improving-rendering-performance-with-css-content-visibility/
[10] content-visibility: the new CSS property that boosts your rendering performance  |  Articles  |  web.dev

https://web.dev/articles/content-visibility
[12] html - WKWebview Scroll becomes slow and laggy when Scrollview delegate methods are implemented - Stack Overflow

https://stackoverflow.com/questions/63830188/wkwebview-scroll-becomes-slow-and-laggy-when-scrollview-delegate-methods-are-imp
