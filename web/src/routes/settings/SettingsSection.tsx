/**
 * The frame of one /settings page (S32, A7 section 2): a labelled region with a heading, an
 * optional one-line description and the body. Since S36 it is the components/ui Card itself
 * (O-346), re-exported under the name the settings pages import (O-360).
 */
export { Card as SettingsSection } from "../../components/ui/index.js";
export type { CardProps as SettingsSectionProps } from "../../components/ui/index.js";
