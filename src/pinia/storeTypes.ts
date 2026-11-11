import type {
    Pinia,
    Store,
    StoreGeneric,
    _ExtractStateFromSetupStore,
    _ExtractGettersFromSetupStore,
    _ExtractActionsFromSetupStore,
} from 'pinia';

/** Match Pinia's setup inference while keeping the raw writer capability outside state. */
export interface NativeStoreDefinition<Id extends string, Setup extends { readonly writers: object }> {
    (
        pinia?: Pinia | null,
        hot?: StoreGeneric
    ): Store<
        Id,
        _ExtractStateFromSetupStore<Omit<Setup, 'writers'>>,
        _ExtractGettersFromSetupStore<Setup>,
        _ExtractActionsFromSetupStore<Setup>
    > & { readonly writers: Setup['writers'] };
    $id: Id;
}
