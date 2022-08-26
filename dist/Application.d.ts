declare type Concrete<Services> = ((app: Application<Services>) => Services[keyof Services]);
declare type Service<S> = {
    register: ((app: Application<S>) => {});
};
declare class Application<Services = Record<string, any>> {
    #private;
    constructor();
    get locked(): boolean;
    lock(): void;
    unlock(): void;
    bind(name: keyof Services, concrete: Concrete<Services>, shared?: boolean): this;
    singleton<ServiceName extends keyof Services>(name: ServiceName, concrete: (app: Application<Services>) => Services[ServiceName]): this;
    make<ServiceName extends keyof Services>(name: ServiceName): Services[ServiceName];
    use(service: Service<Services>): void;
    when<Deps extends (keyof Services)[]>(deps: Deps, callback: (services: Pick<Services, Deps[number]>, app: Application<Services>) => void): void;
}
export default Application;
