import Application from './Application.js';

export interface AppFunction<
    A extends Application<S>,
    S = A extends Application<infer S> ? S : never
> {
    (): A,

    <Name extends keyof S>(serviceName: Name): S[Name]
}

export default <
    A extends Application<S>,
    S = A extends Application<infer S> ? S : never
>(app: A) => (<Name extends keyof S>(name: Name) => name ? app.make(name) : app) as AppFunction<A, S>;
