/** A simple pluggable registry: future rules can register their own adapter. */
export class RuleRegistry {
  #definitions = new Map();
  register(definition) {
    if (!definition?.id || !definition?.name || !definition.target) throw new Error('Invalid rule definition');
    if (this.#definitions.has(definition.id)) throw new Error(`Rule already registered: ${definition.id}`);
    this.#definitions.set(definition.id, Object.freeze({...definition}));
    return this;
  }
  get(id) { return this.#definitions.get(id); }
  list() { return [...this.#definitions.values()]; }
}
