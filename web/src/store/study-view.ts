/**
 * The right column's last open tab on Study, per browser (S45 follow-up, R3.26): read when the
 * address names no view, written whenever the user opens a tab. Guarded storage, so a missing or
 * throwing storage only means the tab is not remembered; a stored value that is not a view reads
 * as none.
 */
import { isStudyView, type StudyView } from "../study/study-views.js";
import { defaultStorage, readJson, writeJson } from "./guarded-storage.js";
import { STUDY_VIEW_STORAGE_KEY } from "./preference-keys.js";

export function readStudyView(storage: Storage | null = defaultStorage()): StudyView | null {
  const value = readJson(storage, STUDY_VIEW_STORAGE_KEY);
  return isStudyView(value) ? value : null;
}

export function writeStudyView(view: StudyView, storage: Storage | null = defaultStorage()): void {
  writeJson(storage, STUDY_VIEW_STORAGE_KEY, view);
}
