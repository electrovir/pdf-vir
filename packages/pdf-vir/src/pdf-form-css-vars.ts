// cspell:word segoe roundhand
import {defineCssVars} from 'lit-css-vars';
import {viraColorPalette} from 'vira';

/**
 * Every CSS var that the form editor and form filler draw themselves with, along with its default.
 * Set any of these on an ancestor element to restyle the fields: custom properties inherit into
 * shadow roots, so one declaration reaches every field on every page.
 *
 * The color defaults come from the raw Vira palette rather than the theme because they are drawn on
 * top of a PDF page, which is always light no matter what the rest of the app is doing: palette
 * colors are fixed hues and only the theme's semantic colors flip in dark mode.
 *
 * @category Internal
 */
export const pdfFormCssVars = defineCssVars({
    'pdf-vir-field-accent-color': viraColorPalette['vira-blue-600'].value,
    'pdf-vir-field-text-color': viraColorPalette['vira-blue-750'].value,
    'pdf-vir-red-accent-color': viraColorPalette['vira-red-650'].value,
    'pdf-vir-page-background-color': viraColorPalette['vira-grey-100'].value,
    'pdf-vir-page-text-color': viraColorPalette['vira-grey-1000'].value,
    'pdf-vir-page-border-color': viraColorPalette['vira-grey-400'].value,
    /**
     * Signature and initials text is drawn in this font. Use the same stack when stamping the text
     * into a PDF so it matches what the signer saw. Which font is actually used depends on what the
     * signer's device has installed.
     */
    'pdf-vir-signature-font-family':
        '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive',
});
