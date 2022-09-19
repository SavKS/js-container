type Concrete<Services> = ((app: Application<Services>) => Services[keyof Services]);

type Binding<Services> = {
    concrete: Concrete<Services>,
    shared: boolean
};

type WatcherCallback<Services, Deps extends (keyof Services)[]> = (
    services: Pick<Services, Deps[number]>,
    app: Application<Services>
) => void;

type Watcher<Services> = {
    deps: (keyof Services)[],
    callback: WatcherCallback<Services, (keyof Services)[]>
};

type Service<S> = {
    register: (app: Application<S>) => void
};

class Application<Services = Record<string, any>> {
    #locked;
    #resolved: Record<keyof Services, Services[keyof Services]> = {} as Services;
    #bindings: Record<keyof Services, Binding<Services>> = {} as Record<keyof Services, Binding<Services>>;
    #watchers: {
        when: Watcher<Services>[]
    } = {
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

    bind(name: keyof Services, concrete: Concrete<Services>, shared = false) {
        this.#bindings[ name ] = { concrete, shared };

        return this;
    }

    singleton<ServiceName extends keyof Services>(
        name: ServiceName,
        concrete: (app: Application<Services>) => Services[ServiceName]
    ) {
        return this.bind(name, concrete, true);
    }

    make<ServiceName extends keyof Services>(name: ServiceName): Services[ServiceName] {
        if (!this.#bindings.hasOwnProperty(name)) {
            throw new Error(`Undeclared service "${ name }"`);
        }

        let instance: Services[ServiceName];
        let wasRecentlyCreated = true;

        if (this.#bindings[ name ].shared) {
            if (!this.#resolved.hasOwnProperty(name)) {
                this.#resolved[ name ] = this.#bindings[ name ].concrete(this);
            } else {
                wasRecentlyCreated = false;
            }

            instance = this.#resolved[ name ] as Services[ServiceName];
        } else {
            instance = this.#bindings[ name ].concrete(this) as Services[ServiceName];
        }

        if (wasRecentlyCreated) {
            this.#watchers.when.forEach(watcher => {
                if (watcher.deps.includes(name)) {
                    let resolvedKeys = Object.keys(this.#resolved) as (keyof Services)[];

                    const resolvedDeps = resolvedKeys.reduce<Services>((carry, serviceName) => {
                        if (watcher.deps.includes(serviceName)) {
                            carry[ serviceName ] = this.#resolved[ serviceName ];
                        }

                        return carry;
                    }, {} as Services);

                    watcher.callback(resolvedDeps, this);
                }
            });
        }

        return instance;
    }

    use(service: Service<Services>) {
        service.register(this);
    }

    when<Deps extends (keyof Services)[]>(
        deps: Deps,
        callback: (services: Pick<Services, Deps[number]>, app: Application<Services>) => void
    ) {
        this.#watchers.when.push({
            deps,
            callback
        });
    }
};

export default Application;
