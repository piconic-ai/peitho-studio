// App-wide settings: their shape, defaults, and how a value arriving over
// IPC is read. Mirrors `src-tauri/src/settings.rs`, which owns the file;
// both read field by field, so a missing, broken or unknown value never
// keeps the app from starting — it just falls back to that field's
// default.
import { LANGUAGE_SETTINGS, type LanguageSetting } from './language'

/** How one setting is read: its default, and which values are valid. */
export interface FieldSpec<T> {
  readonly default: T
  readonly accepts: (value: unknown) => value is T
}

/** One `FieldSpec` per setting in `S`. */
export type SettingsSchema<S> = { readonly [K in keyof S]: FieldSpec<S[K]> }

/** Every setting the app has. Adding one is a field here, its spec in
 * `SETTINGS_SCHEMA`, and the matching field in `settings.rs`. */
export interface Settings {
  /** The UI's language — `system` (the default) follows the OS's
   * preferred language (see `domain/language.ts`). */
  uiLanguage: LanguageSetting
}

/** Some settings to change, the rest left as they are. */
export type SettingsPatch = Partial<Settings>

export const SETTINGS_SCHEMA: SettingsSchema<Settings> = {
  uiLanguage: oneOfField(LANGUAGE_SETTINGS, 'system'),
}

export function booleanField(fallback: boolean): FieldSpec<boolean> {
  return { default: fallback, accepts: (value): value is boolean => typeof value === 'boolean' }
}

/** A setting that is one of `values` (e.g. `['en', 'ja']`). */
export function oneOfField<const V extends string>(values: readonly V[], fallback: V): FieldSpec<V> {
  return { default: fallback, accepts: (value): value is V => typeof value === 'string' && (values as readonly string[]).includes(value) }
}

function keysOf<S>(schema: SettingsSchema<S>): (keyof S & string)[] {
  return Object.keys(schema) as (keyof S & string)[]
}

/** Every setting at its default. */
export function defaultsOf<S>(schema: SettingsSchema<S>): S {
  const settings = {} as S
  for (const key of keysOf(schema)) settings[key] = schema[key].default
  return settings
}

/** `base` with each setting replaced by `input`'s value for it, when
 * `input` has a valid one. Keys the schema doesn't have are dropped, and an
 * `input` that isn't a plain object changes nothing. */
export function overlaySettings<S>(schema: SettingsSchema<S>, base: S, input: unknown): S {
  const next = { ...base }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return next
  for (const key of keysOf(schema)) {
    if (!Object.hasOwn(input, key)) continue
    const value: unknown = (input as Record<string, unknown>)[key]
    if (schema[key].accepts(value)) next[key] = value
  }
  return next
}

/** Settings read from whatever `get_settings`/`settings:changed` handed
 * over: each setting from `raw` when valid, its default otherwise. */
export function parseSettings<S>(schema: SettingsSchema<S>, raw: unknown): S {
  return overlaySettings(schema, defaultsOf(schema), raw)
}
