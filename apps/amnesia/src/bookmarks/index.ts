/**
 * Bookmarks Module
 *
 * Exports bookmark and reading note functionality.
 */

export {
  BookmarkService,
} from './bookmark-service';

export {
  type Bookmark,
  type ReadingNote,
  type BookmarkState,
  type BookmarkAction,
  type BookmarkIndex,
  type NoteIndex,
  type BookReadingArtifacts,
  type CreateBookmarkInput,
  type CreateNoteInput,
  type UpdateBookmarkInput,
  type UpdateNoteInput,
  initialBookmarkState,
  bookmarkReducer,
} from './bookmark-types';
