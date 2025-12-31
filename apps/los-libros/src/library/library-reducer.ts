import type { Book } from './types';
import type { Reducer } from '../helpers/store';

export interface LibraryState {
  books: Book[];
  loading: boolean;
  error: string | null;
  selectedBookId: string | null;
}

export type LibraryAction =
  | { type: 'SET_BOOKS'; payload: Book[] }
  | { type: 'ADD_BOOK'; payload: Book }
  | { type: 'UPDATE_BOOK'; payload: Book }
  | { type: 'REMOVE_BOOK'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SELECT_BOOK'; payload: string | null }
  | { type: 'UPDATE_PROGRESS'; payload: { bookId: string; progress: number; cfi?: string } };

export const libraryReducer: Reducer<LibraryState, LibraryAction> = (state, action) => {
  switch (action.type) {
    case 'SET_BOOKS':
      return { ...state, books: action.payload, loading: false, error: null };

    case 'ADD_BOOK':
      return { ...state, books: [...state.books, action.payload] };

    case 'UPDATE_BOOK':
      return {
        ...state,
        books: state.books.map(book =>
          book.id === action.payload.id ? action.payload : book
        )
      };

    case 'REMOVE_BOOK':
      return {
        ...state,
        books: state.books.filter(book => book.id !== action.payload)
      };

    case 'SET_LOADING':
      return { ...state, loading: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };

    case 'SELECT_BOOK':
      return { ...state, selectedBookId: action.payload };

    case 'UPDATE_PROGRESS':
      return {
        ...state,
        books: state.books.map(book =>
          book.id === action.payload.bookId
            ? {
                ...book,
                progress: action.payload.progress,
                currentCfi: action.payload.cfi ?? book.currentCfi,
                lastRead: new Date()
              }
            : book
        )
      };

    default:
      return state;
  }
};
