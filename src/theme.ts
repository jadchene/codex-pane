import type { CSSProperties } from "vue";
import type { GlobalThemeOverrides } from "naive-ui";
import type { AppearanceSettings } from "./types";

const darkPalette = { background: "#000000", surface: "#050505", raised: "#0b0b0b", border: "#242424", controlBorder: "#4a4a4a", text: "#ffffff", muted: "#a3a3a3", diffAdd: "#213a2b", diffDelete: "#4a221d", diffAddGutter: "#213a2b", diffDeleteGutter: "#4a221d", diffGutterText: "#8b949e", diffAddText: "#3fb950", diffDeleteText: "#f85149" };
const lightPalette = { background: "#ffffff", surface: "#ffffff", raised: "#f6f6f6", border: "#d9d9d9", controlBorder: "#a8a8a8", text: "#111111", muted: "#666666", diffAdd: "#dafbe1", diffDelete: "#ffebe9", diffAddGutter: "#aceebb", diffDeleteGutter: "#ffcecb", diffGutterText: "#1f2328", diffAddText: "#116329", diffDeleteText: "#82071e" };
const defaultFontFamily = '"Segoe UI", "Microsoft YaHei UI", sans-serif';

export const appearanceCssVars = (appearance: AppearanceSettings): CSSProperties => {
  const palette = appearance.theme === "dark" ? darkPalette : lightPalette;
  const fontFamily = appearance.fontFamily.trim() || defaultFontFamily;
  return {
    "--app-bg": palette.background,
    "--app-surface": palette.surface,
    "--app-raised": palette.raised,
    "--app-border": palette.border,
    "--app-control-border": palette.controlBorder,
    "--app-text": palette.text,
    "--app-muted": palette.muted,
    "--app-accent": appearance.accentColor,
    "--app-font-family": fontFamily,
    "--app-font-size": `${appearance.fontSize}px`,
    "--app-diff-add": palette.diffAdd,
    "--app-diff-delete": palette.diffDelete,
    "--app-diff-add-gutter": palette.diffAddGutter,
    "--app-diff-delete-gutter": palette.diffDeleteGutter,
    "--app-diff-gutter-text": palette.diffGutterText,
    "--app-diff-add-text": palette.diffAddText,
    "--app-diff-delete-text": palette.diffDeleteText
  } as CSSProperties;
};

export const appearanceThemeOverrides = (appearance: AppearanceSettings): GlobalThemeOverrides => {
  const palette = appearance.theme === "dark" ? darkPalette : lightPalette;
  const fontFamily = appearance.fontFamily.trim() || defaultFontFamily;
  return {
    common: {
      primaryColor: appearance.accentColor,
      primaryColorHover: appearance.accentColor,
      primaryColorPressed: appearance.accentColor,
      primaryColorSuppl: appearance.accentColor,
      bodyColor: palette.background,
      cardColor: palette.surface,
      modalColor: palette.surface,
      popoverColor: palette.surface,
      tableColor: palette.surface,
      inputColor: palette.raised,
      actionColor: palette.raised,
      borderColor: palette.border,
      dividerColor: palette.border,
      textColorBase: palette.text,
      textColor1: palette.text,
      textColor2: palette.text,
      textColor3: palette.muted,
      fontFamily,
      fontFamilyMono: fontFamily,
      fontSize: `${appearance.fontSize}px`,
      fontSizeMini: `${Math.max(10, appearance.fontSize - 2)}px`,
      fontSizeTiny: `${Math.max(10, appearance.fontSize - 2)}px`,
      fontSizeSmall: `${Math.max(11, appearance.fontSize - 1)}px`,
      fontSizeMedium: `${appearance.fontSize}px`,
      fontSizeLarge: `${appearance.fontSize + 2}px`,
      fontSizeHuge: `${appearance.fontSize + 4}px`
    }
  };
};
