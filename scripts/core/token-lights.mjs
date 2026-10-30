// Token light presets and the scene light switchboard: pure helpers, no Foundry globals.
// Ported from Timos's tested macros "Player & GM Light Controller" v2/v3 (Foundry 14, dnd5e 6.0.x):
// same presets, same gentle look, same off/on/toggle/soften/restore rules.

/** Bright and dim are TOTAL radii in feet. Appearance values are deliberately gentle (v3 macro). */
export const TOKEN_LIGHT_PRESETS = Object.freeze({
  candle:  {bright: 5,  dim: 10,  color: '#A2642A', alpha: .14, luminosity: .20, animation: 'torch', speed: 1, intensity: 1},
  torch:   {bright: 20, dim: 40,  color: '#B87538', alpha: .20, luminosity: .30, animation: 'torch', speed: 2, intensity: 2},
  oil:     {bright: 15, dim: 45,  color: '#B78C54', alpha: .16, luminosity: .25},
  hood:    {bright: 30, dim: 60,  color: '#BBA17B', alpha: .17, luminosity: .30},
  closed:  {bright: 0,  dim: 5,   color: '#AC875B', alpha: .10, luminosity: .12},
  bull:    {bright: 60, dim: 120, color: '#B8A68B', alpha: .18, luminosity: .34, angle: 60},
  light:   {bright: 20, dim: 40,  color: '#ACB9CE', alpha: .16, luminosity: .28},
  flame:   {bright: 20, dim: 40,  color: '#B67B4F', alpha: .17, luminosity: .27, animation: 'torch', speed: 1, intensity: 1},
  produce: {bright: 10, dim: 20,  color: '#B66D3E', alpha: .18, luminosity: .25, animation: 'torch', speed: 2, intensity: 1},
  day:     {bright: 60, dim: 120, color: '#BEBAB0', alpha: .12, luminosity: .45},
  aura:    {bright: 0,  dim: 15,  color: '#7773AC', alpha: .18, luminosity: .12, animation: 'ghost', speed: 1, intensity: 1},
  beacon:  {bright: 10, dim: 30,  color: '#8F8BBE', alpha: .22, luminosity: .25, animation: 'ghost', speed: 2, intensity: 1},
  moon:    {bright: 5,  dim: 20,  color: '#8299B3', alpha: .12, luminosity: .20},
  off:     {bright: 0,  dim: 0,   color: null,      alpha: 0,   luminosity: 0}
});

/** How the presets are grouped in the menus (each group is an <optgroup>). */
export const TOKEN_LIGHT_GROUPS = Object.freeze({
  mundane: ['candle', 'torch', 'oil', 'hood', 'closed', 'bull'],
  spell: ['light', 'flame', 'produce', 'day'],
  vestige: ['aura', 'beacon', 'moon'],
  none: ['off']
});

/** Visual intensity: changes appearance only, never the radii. */
export const LIGHT_STRENGTHS = Object.freeze({gentle: 1, balanced: 1.3, vivid: 1.7});

/** The appearance fields that "soften" changes and "restore look" puts back. */
export const SOFT_FIELDS = Object.freeze(['alpha', 'luminosity', 'coloration', 'saturation', 'contrast', 'shadows']);

/** The switchboard's actions. */
export const SWITCH_ACTIONS = Object.freeze(['off', 'on', 'toggle', 'soften', 'lookrestore']);

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
export function buildTokenLight(key, {strength = 'gentle', units = 'ft', current = {}, animations = null} = {}) {
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
    animation: {type: anim, speed: p.speed ?? 0, intensity: p.intensity ?? 0, reverse: false}
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
