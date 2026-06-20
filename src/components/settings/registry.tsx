"use client";

/**
 * Settings section registry — the single source of truth for the settings
 * view's navigation. To add a settings area: write a section component, then
 * append an entry here. The view renders the nav and routes to the component
 * automatically; nothing else needs to change.
 */

import type { ComponentType, ReactNode } from "react";
import {
  IconBrain,
  IconGear,
  IconImage,
  IconWrench,
  type IconProps,
} from "@/components/ui/icons";
import { AgentsSection } from "./sections/AgentsSection";
import { SchedulerSection } from "./sections/SchedulerSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { FeatureFlagsSection } from "./sections/FeatureFlagsSection";

export interface SettingsSection {
  /** Stable id — used as the active-tab key. */
  id: string;
  label: string;
  /** One-line summary shown under the section heading. */
  summary: ReactNode;
  Icon: ComponentType<IconProps>;
  Component: ComponentType;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "agents",
    label: "Agents & models",
    summary: "Default models per column and the review-cycle cap.",
    Icon: IconBrain,
    Component: AgentsSection,
  },
  {
    id: "scheduler",
    label: "Scheduler",
    summary: "How tasks start and how many run at once.",
    Icon: IconGear,
    Component: SchedulerSection,
  },
  {
    id: "appearance",
    label: "Appearance",
    summary: "Cosmetic preferences, saved per browser.",
    Icon: IconImage,
    Component: AppearanceSection,
  },
  {
    id: "feature-flags",
    label: "Feature flags",
    summary: "Experimental preview features.",
    Icon: IconWrench,
    Component: FeatureFlagsSection,
  },
];

export const DEFAULT_SECTION_ID = SETTINGS_SECTIONS[0]!.id;
