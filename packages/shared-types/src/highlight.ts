/**
 * Highlight types shared between server, plugin, and Doc Doctor
 */

export interface BaseHighlight {
  id: string;
  text: string;
  label?: string;
  color?: HighlightColor;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Inline highlight from Doc Doctor's ==text== system
 */
export interface InlineHighlight extends BaseHighlight {
  type: 'inline';
  documentPath: string;
  range: EditorRange;
  position: {
    from: number;
    to: number;
  };
}

/**
 * Source highlight from reading (Los Libros)
 */
export interface SourceHighlight extends BaseHighlight {
  type: 'source';
  source: HighlightSource;
  annotation?: string;
  atomicNotePath?: string;
}

/**
 * Linked highlight that connects inline to source
 */
export interface LinkedHighlight extends InlineHighlight {
  linkedTo: string; // ID of SourceHighlight
}

export type Highlight = InlineHighlight | SourceHighlight | LinkedHighlight;

export interface HighlightSource {
  type: 'book' | 'article' | 'webpage';
  title: string;
  author?: string;
  bookPath?: string;
  cfi?: string;           // EPUB CFI
  page?: number;          // PDF page
  chapter?: string;
  percentProgress?: number;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange';

export interface EditorRange {
  from: EditorPosition;
  to: EditorPosition;
}

export interface EditorPosition {
  line: number;
  ch: number;
}

/**
 * API response for highlights
 */
export interface HighlightResponse {
  id: string;
  bookId: string;
  text: string;
  annotation?: string;
  color: HighlightColor;
  cfi: string;
  chapter?: string;
  pagePercent?: number;
  createdAt: string;
  updatedAt: string;
}
