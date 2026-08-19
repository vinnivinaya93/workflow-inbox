declare const brand: unique symbol;

/** Nominal typing for domain scalars: Brand<string, 'ActorId'> is not assignable to string. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
