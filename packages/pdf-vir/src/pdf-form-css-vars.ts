// cspell:word segoe roundhand
import {unsafeCSS} from 'element-vir';
import {defineCssVars} from 'lit-css-vars';
import {viraColorPalette, viraTheme} from 'vira';

/**
 * Every CSS var that the form editor and form filler draw themselves with, along with its default.
 * Set any of these on an ancestor element to restyle the fields: custom properties inherit into
 * shadow roots, so one declaration reaches every field on every page.
 *
 * The color defaults are fixed light mode colors rather than theme CSS vars because they are drawn
 * on top of a PDF page, which is always light no matter what the rest of the app is doing.
 *
 * @category Internal
 */
export const pdfFormCssVars = defineCssVars({
    'pdf-vir-field-accent-color': unsafeCSS(
        viraTheme.colors['vira-blue-foreground-header'].foreground.default,
    ),
    'pdf-vir-field-text-color': unsafeCSS(
        viraTheme.colors['vira-blue-foreground-body'].foreground.default,
    ),
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
