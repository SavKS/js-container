import isPromise from 'is-promise';
import { Services } from './Services';

type MaybePromise<T> = T | Promise<T>;

type Concrete<Name extends keyof Services, Services> = ((app: Application<Services>) => MaybePromise<Services[Name]>);

type Binding<Name extends keyof S, S> = {
    concrete: Concrete<Name, S>,
    shared: boolean
};

type ServiceWatcherCallback<Services, Deps extends (keyof Services)[]> = (
    services: Pick<Services, Deps[number]>,
    app: Application<Services>
) => void | Promise<void>;

type ServiceWatcher<Services> = {
    deps: (keyof Services)[],
    callback: ServiceWatcherCallback<Services, (keyof Services)[]>
};

type ServiceProvider<S> = {
    register?: (app: Application<S>) => void
    boot?: (app: Application<S>) => void
};

class Application<S extends Record<string, any> = Services> {
    #sharedResolving: Partial<Record<keyof S, Promise<S[keyof S]>>> = {};
    #shared: Partial<Record<keyof S, S[keyof S]>> = {};
    #bindings: Partial<Record<keyof S, Binding<keyof S, S>>> = {};

    #serviceProviders: ServiceProvider<S>[] = [];

    #booted = false;

    #watchers: {
        onServiceBound: ServiceWatcher<S>[]
        onServiceResolved: ServiceWatcher<S>[]
    } = {
        onServiceBound: [],
        onServiceResolved: [],
    };

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
                dep => this.#bindings.hasOwnProperty(dep)
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
        if (!this.#bindings.hasOwnProperty(name)) {
            throw new Error(`Undeclared service "${ name }"`);
        }

        if (!this.#bindings[ name ]!.shared) {
            return this.#makeServiceInstance(name);
        }

        if (this.#shared.hasOwnProperty(name)) {
            return new Promise<S[Name]>(
                resolve => resolve(this.#shared[ name ]!)
            );
        }

        if (this.#sharedResolving.hasOwnProperty(name)) {
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
        )
    }

    afterResolving<Deps extends (keyof S)[]>(
        deps: Deps,
        callback: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ) {
        this.#watchers.onServiceResolved.push({ deps, callback });
    }

    waitFor<Deps extends (keyof S)[]>(deps: Deps): Promise<Pick<S, Deps[number]>>

    waitFor<Deps extends (keyof S)[]>(
        deps: Deps,
        callback: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ): void

    waitFor<Deps extends (keyof S)[]>(
        deps: Deps,
        callback?: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ): Promise<Pick<S, Deps[number]>> | void {
        const isDepsReady = deps.every(
            dep => this.#bindings.hasOwnProperty(dep)
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

        await this.#handleServiceResolved(name, instance);

        return instance;
    }

    async #handleServiceResolved<Name extends keyof S>(name: Name, instance: S[Name]) {
        await this.#processOnServiceResolvedWatchers(name, instance);
    }

    async #processOnServiceResolvedWatchers<Name extends keyof S>(name: Name, instance: S[Name]) {
        const waitFor = this.#watchers.onServiceResolved.reduce<Promise<any>[]>((carry, watcher) => {
            if (!watcher.deps.includes(name)) {
                return carry;
            }

            const requiredDeps = watcher.deps.filter(dep => dep !== name);

            const resolvedDeps = requiredDeps.reduce((carry, name) => {
                if (this.#shared[ name ]) {
                    carry[ name ] = this.#shared[ name ]!;
                }

                return carry;
            }, { [ name ]: instance } as S);

            if (Object.keys(resolvedDeps).length === requiredDeps.length) {
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
};

export default Application;
