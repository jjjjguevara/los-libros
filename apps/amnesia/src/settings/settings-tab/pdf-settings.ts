/**
 * PDF Settings Tab
 *
 * PDF rendering mode, scale, layout, OCR, and provider settings.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createExplainerBox,
} from '../settings-ui/section-helpers';

export interface PdfSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function PdfSettings({ plugin, containerEl }: PdfSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'PDF',
        'Configure PDF rendering, scale, layout, and OCR settings.'
    );

    // ==========================================================================
    // RENDERING MODE
    // ==========================================================================

    const modeSection = createSection(containerEl, 'cpu', 'Rendering Mode');

    createExplainerBox(modeSection,
        'Auto mode uses the server for better performance when available, ' +
        'falling back to PDF.js (in-browser) when offline.'
    );

    new Setting(modeSection)
        .setName('Provider Mode')
        .setDesc('Choose how PDFs are rendered')
        .addDropdown(dropdown => dropdown
            .addOption('auto', 'Automatic (Recommended)')
            .addOption('server', 'Server Only')
            .setValue(settings.pdf.preferMode)
            .onChange(async (value) => {
                settings.pdf.preferMode = value as 'auto' | 'server';
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // DISPLAY SETTINGS
    // ==========================================================================

    const displaySection = createSection(containerEl, 'layout', 'Display');

    new Setting(displaySection)
        .setName('Default Scale')
        .setDesc('Zoom level for PDF pages (1.0 = 100%)')
        .addSlider(slider => slider
            .setLimits(0.5, 3.0, 0.1)
            .setValue(settings.pdf.scale)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.pdf.scale = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(button => button
            .setIcon('reset')
            .setTooltip('Reset to 150%')
            .onClick(async () => {
                settings.pdf.scale = 1.5;
                await plugin.saveSettings();
                // Refresh the settings display
                containerEl.empty();
                PdfSettings({ plugin, containerEl });
            }));

    new Setting(displaySection)
        .setName('Page Layout')
        .setDesc('How pages are displayed')
        .addDropdown(dropdown => dropdown
            .addOption('single', 'Single Page')
            .addOption('dual', 'Dual Pages')
            .addOption('book', 'Book Spread (cover on right)')
            .setValue(settings.pdf.pageLayout)
            .onChange(async (value) => {
                settings.pdf.pageLayout = value as 'single' | 'dual' | 'book';
                await plugin.saveSettings();
            }));

    new Setting(displaySection)
        .setName('Default Rotation')
        .setDesc('Default page rotation')
        .addDropdown(dropdown => dropdown
            .addOption('0', '0° (Normal)')
            .addOption('90', '90° Clockwise')
            .addOption('180', '180°')
            .addOption('270', '270° Counter-clockwise')
            .setValue(String(settings.pdf.rotation))
            .onChange(async (value) => {
                settings.pdf.rotation = parseInt(value) as 0 | 90 | 180 | 270;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // TEXT & SELECTION
    // ==========================================================================

    const textSection = createSection(containerEl, 'text-cursor', 'Text & Selection');

    new Setting(textSection)
        .setName('Show Text Layer')
        .setDesc('Enable text selection and search in PDFs')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.showTextLayer)
            .onChange(async (value) => {
                settings.pdf.showTextLayer = value;
                await plugin.saveSettings();
            }));

    new Setting(textSection)
        .setName('Region Selection')
        .setDesc('Allow drawing rectangles for OCR on scanned pages')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.enableRegionSelection)
            .onChange(async (value) => {
                settings.pdf.enableRegionSelection = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // OCR SETTINGS
    // ==========================================================================

    const ocrSection = createSection(containerEl, 'scan', 'OCR (Optical Character Recognition)');

    createExplainerBox(ocrSection,
        'OCR extracts text from scanned PDFs and images. Requires the server to be running. ' +
        'Tesseract is faster for simple documents; Ollama provides better accuracy for complex layouts.'
    );

    new Setting(ocrSection)
        .setName('Enable OCR')
        .setDesc('Enable OCR for scanned PDFs (requires server)')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.enableOcr)
            .onChange(async (value) => {
                settings.pdf.enableOcr = value;
                await plugin.saveSettings();
            }));

    new Setting(ocrSection)
        .setName('OCR Provider')
        .setDesc('Which OCR engine to use')
        .addDropdown(dropdown => dropdown
            .addOption('tesseract', 'Tesseract (Fast)')
            .addOption('ollama', 'Ollama Vision (Accurate)')
            .setValue(settings.pdf.ocrProvider)
            .onChange(async (value) => {
                settings.pdf.ocrProvider = value as 'tesseract' | 'ollama';
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // PERFORMANCE & OPTIMIZATION
    // ==========================================================================

    const perfSection = createSection(containerEl, 'gauge', 'Performance & Optimization');

    createExplainerBox(perfSection,
        'Fine-tune rendering quality and performance. Higher DPI produces sharper text but uses more memory and bandwidth.'
    );

    new Setting(perfSection)
        .setName('Render DPI')
        .setDesc('DPI for server-side rendering. Higher = sharper, slower.')
        .addDropdown(dropdown => dropdown
            .addOption('72', '72 DPI (Fast, Low Quality)')
            .addOption('96', '96 DPI (Screen)')
            .addOption('150', '150 DPI (Recommended)')
            .addOption('200', '200 DPI (High Quality)')
            .addOption('300', '300 DPI (Print Quality)')
            .setValue(String(settings.pdf.renderDpi))
            .onChange(async (value) => {
                settings.pdf.renderDpi = parseInt(value) as 72 | 96 | 150 | 200 | 300;
                await plugin.saveSettings();
            }));

    new Setting(perfSection)
        .setName('Image Format')
        .setDesc('Output format for rendered pages')
        .addDropdown(dropdown => dropdown
            .addOption('png', 'PNG (Best for text)')
            .addOption('jpeg', 'JPEG (Smaller files)')
            .addOption('webp', 'WebP (Best compression)')
            .setValue(settings.pdf.imageFormat)
            .onChange(async (value) => {
                settings.pdf.imageFormat = value as 'png' | 'jpeg' | 'webp';
                await plugin.saveSettings();
            }));

    new Setting(perfSection)
        .setName('Image Quality')
        .setDesc('Quality for JPEG/WebP (1-100)')
        .addSlider(slider => slider
            .setLimits(50, 100, 5)
            .setValue(settings.pdf.imageQuality)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.pdf.imageQuality = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(button => button
            .setIcon('reset')
            .setTooltip('Reset to 85')
            .onClick(async () => {
                settings.pdf.imageQuality = 85;
                await plugin.saveSettings();
                containerEl.empty();
                PdfSettings({ plugin, containerEl });
            }));

    // ==========================================================================
    // CACHING & PRELOADING
    // ==========================================================================

    const cacheSection = createSection(containerEl, 'hard-drive', 'Caching & Preloading');

    createExplainerBox(cacheSection,
        'Caching stores rendered pages for faster navigation. Preloading fetches upcoming pages in advance.'
    );

    new Setting(cacheSection)
        .setName('Enable Page Cache')
        .setDesc('Cache rendered pages for faster navigation')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.enablePageCache)
            .onChange(async (value) => {
                settings.pdf.enablePageCache = value;
                await plugin.saveSettings();
            }));

    new Setting(cacheSection)
        .setName('Cache Size')
        .setDesc('Maximum pages to keep in memory cache')
        .addSlider(slider => slider
            .setLimits(5, 50, 5)
            .setValue(settings.pdf.pageCacheSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.pdf.pageCacheSize = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(button => button
            .setIcon('reset')
            .setTooltip('Reset to 10')
            .onClick(async () => {
                settings.pdf.pageCacheSize = 10;
                await plugin.saveSettings();
                containerEl.empty();
                PdfSettings({ plugin, containerEl });
            }));

    new Setting(cacheSection)
        .setName('Preload Pages')
        .setDesc('Number of pages to preload ahead of current position')
        .addSlider(slider => slider
            .setLimits(0, 5, 1)
            .setValue(settings.pdf.pagePreloadCount)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.pdf.pagePreloadCount = value;
                await plugin.saveSettings();
            }))
        .addExtraButton(button => button
            .setIcon('reset')
            .setTooltip('Reset to 2')
            .onClick(async () => {
                settings.pdf.pagePreloadCount = 2;
                await plugin.saveSettings();
                containerEl.empty();
                PdfSettings({ plugin, containerEl });
            }));

    // ==========================================================================
    // RENDERING QUALITY
    // ==========================================================================

    const qualitySection = createSection(containerEl, 'sliders', 'Rendering Quality');

    new Setting(qualitySection)
        .setName('Image Smoothing')
        .setDesc('Smooth image scaling (disable for pixelated look)')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.enableImageSmoothing)
            .onChange(async (value) => {
                settings.pdf.enableImageSmoothing = value;
                await plugin.saveSettings();
            }));

    new Setting(hwSection)
        .setName('Text Anti-aliasing')
        .setDesc('Smooth text edges for better readability')
        .addToggle(toggle => toggle
            .setValue(settings.pdf.enableTextAntialiasing)
            .onChange(async (value) => {
                settings.pdf.enableTextAntialiasing = value;
                await plugin.saveSettings();
            }));
}
