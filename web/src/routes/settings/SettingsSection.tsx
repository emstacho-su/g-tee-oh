/**
 * The frame of one /settings page (S32, A7 section 2): a labelled region with a heading, an
 * optional one-line description and the body. Since S36 it is the components/ui Card (O-346), the
 * one panel the settings container shows at a time (O-360).
 */
import type { ReactNode } from "react";

import { Card } from "../../components/ui/index.js";

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <Card title={title} {...(description === undefined ? {} : { description })}>
      {children}
    </Card>
  );
}
