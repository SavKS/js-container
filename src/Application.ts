type MaybePromise<T> = T | Promise<T>;

type Concrete<Name extends keyof S, S> = ((app: Application<S>) => MaybePromise<S[Name]>);

type Binding<Name extends keyof S, S> = {
    concrete: Concrete<Name, S>,
    shared: boolean
};

type ServiceWatcherCallback<S, Deps extends (keyof S)[]> = (
    services: Pick<S, Deps[number]>,
    app: Application<S>
) => void | Promise<void>;

type ServiceWatcher<S> = {
    deps: (keyof S)[],
    callback: ServiceWatcherCallback<S, (keyof S)[]>
};

type ServiceProvider<S> = {
    register?: (app: Application<S>) => void,
    boot?: (app: Application<S>) => void
};

class Application<S> {
    #sharedResolving: Partial<Record<keyof S, Promise<S[keyof S]>>> = {};
    #shared: Partial<S> = {};
    #bindings: Partial<Record<keyof S, Binding<keyof S, S>>> = {};

    #serviceProviders: ServiceProvider<S>[] = [];

    #booted = false;

    #watchers: {
        onServiceBound: ServiceWatcher<S>[],
        onServiceResolved: ServiceWatcher<S>[]
    } = { onServiceBound: [], onServiceResolved: [] };

    get booted() {
        return this.#booted;
    }

    bind<Name extends keyof S>(
        name: Name,
        concrete: Concrete<Name, S>,
        shared = false
    ) {
        this.#bindings[ name ] = { concrete, shared };

        this.#handleServiceBound(name);

        return this;
    }

    #handleServiceBound<Name extends keyof S>(name: Name) {
        this.#processOnServiceBoundWatchers(name);
    }

    #processOnServiceBoundWatchers<Name extends keyof S>(name: Name) {
        this.#watchers.onServiceBound.forEach(async watcher => {
            if (!watcher.deps.includes(name)) {
                return;
            }

            const isReady = watcher.deps.every(
                dep => Object.hasOwn(this.#bindings, dep)
            );

            if (!isReady) {
                return;
            }

            const resolvedDeps = Object.fromEntries(
                await Promise.all(
                    watcher.deps.map(async name => [
                        name,
                        await this.make(name)
                    ])
                )
            ) as S;

            watcher.callback(resolvedDeps, this);
        });
    }

    singleton<Name extends keyof S>(
        name: Name,
        concrete: (app: Application<S>) => MaybePromise<S[Name]>
    ) {
        return this.bind(name, concrete, true);
    }

    make<Name extends keyof S>(name: Name): Promise<S[Name]> {
        if (!Object.hasOwn(this.#bindings, name)) {
            throw new Error(`Undeclared service "${ typeof name === 'string' ? name : name.toString() }"`);
        }

        if (!this.#bindings[ name ]!.shared) {
            return this.#makeServiceInstance(name);
        }

        if (Object.hasOwn(this.#shared, name)) {
            return new Promise<S[Name]>(
                resolve => resolve(this.#shared[ name ]!)
            );
        }

        if (Object.hasOwn(this.#sharedResolving, name)) {
            return this.#sharedResolving[ name ]! as Promise<S[Name]>;
        }

        this.#sharedResolving[ name ] = this.#makeSingleton(name);

        return this.#sharedResolving[ name ]! as Promise<S[Name]>;
    }

    use(serviceProvider: ServiceProvider<S>) {
        serviceProvider.register?.(this);

        if (this.booted) {
            serviceProvider.boot?.(this);
        }

        this.#serviceProviders.push(serviceProvider);
    }

    boot() {
        this.#serviceProviders.forEach(
            serviceProvider => serviceProvider.boot?.(this)
        );
    }

    afterResolving<Deps extends (keyof S)[]>(
        deps: Deps,
        callback: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ) {
        this.#watchers.onServiceResolved.push({ deps, callback });
    }

    waitFor<Deps extends (keyof S)[]>(deps: Deps): Promise<Pick<S, Deps[number]>>;

    waitFor<Deps extends (keyof S)[]>(
        deps: Deps,
        callback: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ): void;

    waitFor<Deps extends (keyof S)[]>(
        deps: Deps,
        callback?: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ): Promise<Pick<S, Deps[number]>> | void {
        const isDepsReady = deps.every(
            dep => Object.hasOwn(this.#bindings, dep)
        );

        if (isDepsReady) {
            const services = (async () => {
                const resolvedDeps = Object.fromEntries(
                    await Promise.all(
                        deps.map(async name => [
                            name,
                            await this.make(name)
                        ])
                    )
                ) as S;

                callback?.(resolvedDeps, this);

                return resolvedDeps;
            })();

            if (!callback) {
                return services;
            }
        } else {
            if (callback) {
                this.#watchers.onServiceBound.push({ deps, callback });
            } else {
                return new Promise(resolve => {
                    this.#watchers.onServiceBound.push({
                        deps,
                        callback: services => {
                            resolve(services);
                        }
                    });
                });
            }
        }
    }

    async #makeServiceInstance<Name extends keyof S>(name: Name): Promise<S[Name]> {
        const concrete = this.#bindings[ name ]!.concrete(this);

        const instance = (isPromise(concrete) ? await concrete : concrete)!;

        await this.#handleServiceResolved(name, instance as S[Name]);

        return instance as S[Name];
    }

    async #handleServiceResolved<Name extends keyof S>(name: Name, instance: S[Name]) {
        await this.#processOnServiceResolvedWatchers(name, instance);
    }

    async #processOnServiceResolvedWatchers<Name extends keyof S>(name: Name, instance: S[Name]) {
        const waitFor = this.#watchers.onServiceResolved.reduce<Promise<any>[]>((carry, watcher) => {
            if (!watcher.deps.includes(name)) {
                return carry;
            }

            const resolvedDeps = watcher.deps.reduce((carry, depName) => {
                if (depName === name) {
                    carry[ depName ] = instance;
                } else if (this.#shared[ depName ]) {
                    carry[ depName ] = this.#shared[ depName ]!;
                }

                return carry;
            }, { [ name ]: instance } as any);

            if (Object.keys(resolvedDeps).length === watcher.deps.length + 1) {
                const result = watcher.callback(resolvedDeps, this);

                if (isPromise(result)) {
                    carry.push(result);
                }
            }

            return carry;
        }, []);

        if (waitFor.length) {
            await Promise.all(waitFor);
        }
    }

    async #makeSingleton<Name extends keyof S>(name: Name): Promise<S[Name]> {
        const instance = await this.#makeServiceInstance(name);

        this.#shared[ name ] = instance;

        return instance;
    }
}

export default Application;

function isPromise<T, S>(obj: PromiseLike<T> | S): obj is PromiseLike<T> {
    return !!obj
        && (typeof obj === 'object' || typeof obj === 'function')
        && 'then' in obj
        && typeof obj.then === 'function';
}
