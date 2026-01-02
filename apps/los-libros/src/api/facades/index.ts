/**
 * API Facades
 * @module api/facades
 */

export { LibraryAPI, createLibraryAPI } from './library';
export { HighlightsAPI, createHighlightsAPI } from './highlights';
export { BookmarksAPI, createBookmarksAPI } from './bookmarks';
export { ReaderAPI, createReaderAPI, getReaderStateStore, readerBridge } from './reader';
