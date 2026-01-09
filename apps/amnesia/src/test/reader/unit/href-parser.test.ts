/**
 * Unit tests for href-parser utility
 *
 * Tests parsing of EPUB href schemes:
 * - position:N - Navigate to spine position N (0-indexed)
 * - page:N - Navigate to page N (1-indexed)
 * - Standard hrefs with optional fragments
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseHref, isSpecialScheme, pageToSpineIndex } from '../../../reader/utils/href-parser';

describe('href-parser', () => {
  // Capture console.warn calls
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('parseHref', () => {
    describe('position:N scheme', () => {
      it('should parse valid position scheme', () => {
        expect(parseHref('position:0')).toEqual({ type: 'position', spineIndex: 0 });
        expect(parseHref('position:5')).toEqual({ type: 'position', spineIndex: 5 });
        expect(parseHref('position:100')).toEqual({ type: 'position', spineIndex: 100 });
      });

      it('should handle invalid position (negative)', () => {
        const result = parseHref('position:-1');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid position scheme'));
      });

      it('should handle invalid position (non-numeric)', () => {
        const result = parseHref('position:abc');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid position scheme'));
      });

      it('should handle invalid position (float)', () => {
        // parseInt stops at decimal point, so '5.5' becomes 5
        const result = parseHref('position:5.5');
        expect(result).toEqual({ type: 'position', spineIndex: 5 });
      });

      it('should handle invalid position (empty)', () => {
        const result = parseHref('position:');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalled();
      });

      it('should handle extremely large numbers safely', () => {
        // Number.MAX_SAFE_INTEGER + 1 is not a safe integer
        const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
        const result = parseHref(`position:${unsafeNumber}`);
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe('page:N scheme', () => {
      it('should parse valid page scheme', () => {
        expect(parseHref('page:1')).toEqual({ type: 'page', pageNumber: 1 });
        expect(parseHref('page:10')).toEqual({ type: 'page', pageNumber: 10 });
        expect(parseHref('page:999')).toEqual({ type: 'page', pageNumber: 999 });
      });

      it('should handle invalid page (zero)', () => {
        const result = parseHref('page:0');
        expect(result).toEqual({ type: 'page', pageNumber: 1 });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid page scheme'));
      });

      it('should handle invalid page (negative)', () => {
        const result = parseHref('page:-5');
        expect(result).toEqual({ type: 'page', pageNumber: 1 });
        expect(warnSpy).toHaveBeenCalled();
      });

      it('should handle invalid page (non-numeric)', () => {
        const result = parseHref('page:xyz');
        expect(result).toEqual({ type: 'page', pageNumber: 1 });
        expect(warnSpy).toHaveBeenCalled();
      });

      it('should handle extremely large page numbers safely', () => {
        const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
        const result = parseHref(`page:${unsafeNumber}`);
        expect(result).toEqual({ type: 'page', pageNumber: 1 });
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe('standard href', () => {
      it('should parse href without fragment', () => {
        expect(parseHref('chapter1.xhtml')).toEqual({
          type: 'standard',
          href: 'chapter1.xhtml',
        });
      });

      it('should parse href with fragment', () => {
        expect(parseHref('chapter1.xhtml#section2')).toEqual({
          type: 'standard',
          href: 'chapter1.xhtml',
          fragment: 'section2',
        });
      });

      it('should handle href with path', () => {
        expect(parseHref('OEBPS/Text/chapter1.xhtml')).toEqual({
          type: 'standard',
          href: 'OEBPS/Text/chapter1.xhtml',
        });
      });

      it('should handle href with path and fragment', () => {
        expect(parseHref('OEBPS/Text/chapter1.xhtml#para5')).toEqual({
          type: 'standard',
          href: 'OEBPS/Text/chapter1.xhtml',
          fragment: 'para5',
        });
      });

      it('should handle fragment-only href', () => {
        expect(parseHref('#section1')).toEqual({
          type: 'standard',
          href: '',
          fragment: 'section1',
        });
      });

      it('should handle multiple # in href (only first is fragment delimiter)', () => {
        expect(parseHref('chapter.xhtml#section#subsection')).toEqual({
          type: 'standard',
          href: 'chapter.xhtml',
          fragment: 'section#subsection',
        });
      });
    });

    describe('empty and whitespace hrefs', () => {
      it('should handle empty string', () => {
        const result = parseHref('');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Empty href'));
      });

      it('should handle whitespace-only string', () => {
        const result = parseHref('   ');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalled();
      });

      it('should handle tabs and newlines', () => {
        const result = parseHref('\t\n');
        expect(result).toEqual({ type: 'position', spineIndex: 0 });
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe('edge cases', () => {
      it('should not confuse position: in the middle of href', () => {
        // Only matches if href STARTS with position:
        expect(parseHref('file:position:5')).toEqual({
          type: 'standard',
          href: 'file:position:5',
        });
      });

      it('should not confuse page: in the middle of href', () => {
        expect(parseHref('mypage:10.html')).toEqual({
          type: 'standard',
          href: 'mypage:10.html',
        });
      });

      it('should handle case-sensitive scheme matching', () => {
        // Schemes are case-sensitive - Position: is not position:
        expect(parseHref('Position:5')).toEqual({
          type: 'standard',
          href: 'Position:5',
        });
        expect(parseHref('PAGE:10')).toEqual({
          type: 'standard',
          href: 'PAGE:10',
        });
      });
    });
  });

  describe('isSpecialScheme', () => {
    it('should return true for position scheme', () => {
      expect(isSpecialScheme('position:0')).toBe(true);
      expect(isSpecialScheme('position:abc')).toBe(true); // Still starts with position:
    });

    it('should return true for page scheme', () => {
      expect(isSpecialScheme('page:1')).toBe(true);
      expect(isSpecialScheme('page:xyz')).toBe(true);
    });

    it('should return false for standard hrefs', () => {
      expect(isSpecialScheme('chapter1.xhtml')).toBe(false);
      expect(isSpecialScheme('OEBPS/Text/chapter1.xhtml#section2')).toBe(false);
      expect(isSpecialScheme('')).toBe(false);
    });
  });

  describe('pageToSpineIndex', () => {
    it('should convert page 1 to spine index 0', () => {
      expect(pageToSpineIndex(1, 10)).toBe(0);
    });

    it('should convert middle page correctly', () => {
      expect(pageToSpineIndex(5, 10)).toBe(4);
    });

    it('should convert last page correctly', () => {
      expect(pageToSpineIndex(10, 10)).toBe(9);
    });

    it('should return -1 for page 0 (invalid)', () => {
      expect(pageToSpineIndex(0, 10)).toBe(-1);
    });

    it('should return -1 for negative page', () => {
      expect(pageToSpineIndex(-1, 10)).toBe(-1);
    });

    it('should return -1 for page beyond spine length', () => {
      expect(pageToSpineIndex(11, 10)).toBe(-1);
      expect(pageToSpineIndex(100, 10)).toBe(-1);
    });

    it('should handle edge case of single-page spine', () => {
      expect(pageToSpineIndex(1, 1)).toBe(0);
      expect(pageToSpineIndex(2, 1)).toBe(-1);
    });

    it('should handle empty spine', () => {
      expect(pageToSpineIndex(1, 0)).toBe(-1);
    });
  });
});
