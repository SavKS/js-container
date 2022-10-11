import isPromise from 'is-promise';
import { Services } from './Services';

type MaybePromise<T> = T | Promise<T>;

type Concrete<Name extends keyof Services, Services> = ((app: Application<Services>) => MaybePromise<Services[Name]>);

type Binding<Name extends keyof S, S> = {
    concrete: Concrete<Name, S>,
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

class Application<S extends Record<string, any> = Services> {
    #singletonResolving: Partial<Record<keyof S, Promise<S[keyof S]>>> = {};
    #locked;
    #shared: Partial<Record<keyof S, S[keyof S]>> = {};
    #bindings: Partial<Record<keyof S, Binding<keyof S, S>>> = {};
    #watchers: {
        when: Watcher<S>[]
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

    bind<Name extends keyof S>(
        name: Name,
        concrete: Concrete<Name, S>,
        shared = false
    ) {
        this.#bindings[ name ] = { concrete, shared };

        return this;
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
            return this.#makeInstance(name);
        }

        if (this.#shared.hasOwnProperty(name)) {
            return new Promise<S[Name]>(
                resolve => resolve(this.#shared[ name ]!)
            );
        }

        if (this.#singletonResolving.hasOwnProperty(name)) {
            return this.#singletonResolving[name]! as Promise<S[Name]>;
        }

        this.#singletonResolving[name] = this.#makeSingleton(name);

        return this.#singletonResolving[name]! as Promise<S[Name]>;
    }

    use(service: Service<S>) {
        service.register(this);
    }

    when<Deps extends (keyof S)[]>(
        deps: Deps,
        callback: (services: Pick<S, Deps[number]>, app: Application<S>) => void
    ) {
        this.#watchers.when.push({
            deps,
            callback
        });
    }

    #onCreated<Name extends keyof S>(name: Name) {
        this.#watchers.when.forEach(watcher => {
            if (watcher.deps.includes(name)) {
                let resolvedKeys = Object.keys(this.#shared) as (keyof S)[];

                const resolvedDeps = resolvedKeys.reduce<S>((carry, serviceName) => {
                    if (watcher.deps.includes(serviceName)) {
                        carry[ serviceName ] = this.#shared[ serviceName ]!;
                    }

                    return carry;
                }, {} as S);

                watcher.callback(resolvedDeps, this);
            }
        });
    }

    async #makeInstance<Name extends keyof S>(name: Name): Promise<S[Name]> {
        const concrete = this.#bindings[ name ]!.concrete(this);

        const instance = (isPromise(concrete) ? await concrete : concrete)!;

        this.#onCreated(name);

        return instance;
    }

    async #makeSingleton<Name extends keyof S>(name: Name): Promise<S[Name]> {
        const instance = await this.#makeInstance(name);

        this.#shared[ name ] = instance;

        return instance;
    }
};

export default Application;
