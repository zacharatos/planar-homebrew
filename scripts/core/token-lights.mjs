// Token light presets and the scene light switchboard: pure helpers, no Foundry globals.
// Ported from Timos's tested macros "Player & GM Light Controller" v2/v3 (Foundry 14, dnd5e 6.0.x):
// same presets and off/on/toggle/soften/restore rules; the look was retuned in 0.10.0.

/**
 * Bright and dim are TOTAL radii in feet. The look (colour, colour intensity = alpha, luminosity,
 * animation) is the "Balanced" one; Gentle and Vivid scale it. Flames are warm and saturated with a
 * visible flicker so they read as fire on a dark, blue-tinted night map (0.10.0 retune: the v3 macro's
 * muted colours at alpha .2 and a 2/10 flicker looked like a still white light under Adaptive Luminance).
 */
export const TOKEN_LIGHT_PRESETS = Object.freeze({
  candle:  {bright: 5,  dim: 10,  color: '#FFB357', alpha: .40, luminosity: .40, animation: 'torch', speed: 3, intensity: 4},
  torch:   {bright: 20, dim: 40,  color: '#FF9A3C', alpha: .50, luminosity: .50, animation: 'torch', speed: 4, intensity: 5},
  oil:     {bright: 15, dim: 45,  color: '#FFBE6B', alpha: .42, luminosity: .45, animation: 'flame', speed: 2, intensity: 3},
  hood:    {bright: 30, dim: 60,  color: '#FFC878', alpha: .42, luminosity: .45, animation: 'flame', speed: 2, intensity: 3},
  closed:  {bright: 0,  dim: 5,   color: '#E89A4A', alpha: .30, luminosity: .20, animation: 'flame', speed: 2, intensity: 2},
  bull:    {bright: 60, dim: 120, color: '#FFD08A', alpha: .40, luminosity: .50, animation: 'flame', speed: 1, intensity: 2, angle: 60},
  light:   {bright: 20, dim: 40,  color: '#F6F0D8', alpha: .25, luminosity: .45},
  flame:   {bright: 20, dim: 40,  color: '#FFA94D', alpha: .45, luminosity: .45, animation: 'torch', speed: 2, intensity: 3},
  produce: {bright: 10, dim: 20,  color: '#FF8A2A', alpha: .55, luminosity: .45, animation: 'torch', speed: 4, intensity: 5},
  day:     {bright: 60, dim: 120, color: '#FFF6DC', alpha: .20, luminosity: .60},
  aura:    {bright: 0,  dim: 15,  color: '#8E7CFF', alpha: .45, luminosity: .25, animation: 'ghost', speed: 2, intensity: 3},
  beacon:  {bright: 10, dim: 30,  color: '#A79BFF', alpha: .50, luminosity: .35, animation: 'ghost', speed: 3, intensity: 4},
  moon:    {bright: 5,  dim: 20,  color: '#9DBBE6', alpha: .35, luminosity: .30},
  off:     {bright: 0,  dim: 0,   color: null,      alpha: 0,   luminosity: 0}
});

/** How the presets are grouped in the menus (each group is an <optgroup>). */
export const TOKEN_LIGHT_GROUPS = Object.freeze({
  mundane: ['candle', 'torch', 'oil', 'hood', 'closed', 'bull'],
  spell: ['light', 'flame', 'produce', 'day'],
  vestige: ['aura', 'beacon', 'moon'],
  none: ['off']
});

/** Look: scales colour intensity, luminosity and flicker strength, never the radii. Balanced = the preset as written. */
export const LIGHT_STRENGTHS = Object.freeze({gentle: .7, balanced: 1, vivid: 1.3});
export const DEFAULT_STRENGTH = 'balanced';

/** The appearance fields that "soften" changes and "restore look" puts back. */
export const SOFT_FIELDS = Object.freeze(['alpha', 'luminosity', 'coloration', 'saturation', 'contrast', 'shadows']);

/** The switchboard's actions. */
export const SWITCH_ACTIONS = Object.freeze(['off', 'on', 'toggle', 'soften', 'lookrestore', 'preset']);

/** Presets the scene switchboard can give ("no light" is the switchboard's own Turn off). */
export const isScenePreset = key => isTokenLightPreset(key) && key !== 'off';

export const clamp = (x, min, max) => Math.min(max, Math.max(min, Number(x) || 0));

/** Feet → scene units. Metres are converted; feet and anything unknown stay as they are (macro behaviour). */
export function feetToSceneUnits(feet, units = 'ft') {
  const unit = String(units ?? 'ft').trim().toLowerCase();
  return ['m', 'meter', 'meters', 'metre', 'metres'].includes(unit) ? Math.round(feet * .3048 * 100) / 100 : feet;
}

export const isTokenLightPreset = key => Object.hasOwn(TOKEN_LIGHT_PRESETS, key);

/**
 * The full token `light` object for a preset, merged over the token's current light (so fields this
 * module doesn't set are kept). `animations` is CONFIG.Canvas.lightAnimations: an animation Foundry
 * doesn't know is dropped instead of failing.
 */
export function buildTokenLight(key, {strength = DEFAULT_STRENGTH, units = 'ft', current = {}, animations = null} = {}) {
  const p = TOKEN_LIGHT_PRESETS[key];
  if (!p) return null;
  const s = LIGHT_STRENGTHS[strength] ?? (Number.isFinite(Number(strength)) ? Number(strength) : 1);
  const anim = p.animation && (!animations || Object.hasOwn(animations, p.animation)) ? p.animation : '';
  return {
    ...structuredClone(current ?? {}),
    bright: feetToSceneUnits(p.bright, units),
    dim: feetToSceneUnits(p.dim, units),
    angle: p.angle ?? 360,
    color: p.color,
    alpha: clamp(p.alpha * s, 0, 1),
    luminosity: clamp(p.luminosity * s, 0, 1),
    coloration: 1, saturation: 0, contrast: 0, shadows: 0,
    negative: false,
    darkness: {min: 0, max: 1},
    animation: {type: anim, speed: p.speed ?? 0, intensity: p.intensity ? clamp(Math.round(p.intensity * s), 1, 10) : 0, reverse: false}
  };
}

/** A light that gives light (not magical darkness). */
export const emitsLight = light => !light?.negative && (Number(light?.bright) > 0 || Number(light?.dim) > 0);

/** What toggle means for one source: off if it is on and not already switched off by us, else on. */
export function resolveSwitchAction(action, {lit, saved}) {
  if (action !== 'toggle') return action;
  return saved || !lit ? 'on' : 'off';
}

/** The softened look of a light (v3 macro): weaker colour and luminosity, ranges untouched. */
export function softenedLook(model = {}) {
  return {
    alpha: clamp(Number(model.alpha) * .45, 0, .23),
    luminosity: clamp(Number(model.luminosity) * .55, 0, .30),
    coloration: 1, saturation: 0, contrast: 0, shadows: 0
  };
}

/** The fields to save before softening, so "restore look" can put them back exactly. */
export const savedLook = (model = {}) => Object.fromEntries(SOFT_FIELDS.map(k => [k, model[k]]));

/** Which sources the switchboard acts on: every one, the ones selected on the canvas, or the ticked ones. */
export function pickTargets(scope, {all = [], selected = [], checked = []}) {
  const ids = scope === 'all' ? all : scope === 'selected' ? selected : checked;
  return [...new Set(ids)].filter(id => all.includes(id));
}
