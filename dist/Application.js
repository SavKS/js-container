class Application {
    #locked;
    #resolved = {};
    #bindings = {};
    #watchers = {
        when: []
    };
    constructor() {
        this.#locked = false;
    }
    get locked() {
        return this.#locked;
    }
    lock() {
        this.#locked = true;
    }
    unlock() {
        this.#locked = true;
    }
    bind(name, concrete, shared = false) {
        this.#bindings[name] = { concrete, shared };
        return this;
    }
    singleton(name, concrete) {
        return this.bind(name, concrete, true);
    }
    make(name) {
        if (!this.#bindings.hasOwnProperty(name)) {
            throw new Error(`Undeclared service "${name}"`);
        }
        let instance;
        let wasRecentlyCreated = true;
        if (this.#bindings[name].shared) {
            if (!this.#resolved.hasOwnProperty(name)) {
                this.#resolved[name] = this.#bindings[name].concrete(this);
            }
            else {
                wasRecentlyCreated = false;
            }
            instance = this.#resolved[name];
        }
        else {
            instance = this.#bindings[name].concrete(this);
        }
        if (wasRecentlyCreated) {
            this.#watchers.when.forEach(watcher => {
                if (watcher.deps.includes(name)) {
                    let resolvedKeys = Object.keys(this.#resolved);
                    const resolvedDeps = resolvedKeys.reduce((carry, serviceName) => {
                        if (watcher.deps.includes(serviceName)) {
                            carry[serviceName] = this.#resolved[serviceName];
                        }
                        return carry;
                    }, {});
                    watcher.callback(resolvedDeps, this);
                }
            });
        }
        return instance;
    }
    use(service) {
        service.register(this);
    }
    when(deps, callback) {
        this.#watchers.when.push({
            deps,
            callback
        });
    }
}
;
export default Application;
//# sourceMappingURL=Application.js.map