// A stand-in for a SvelteKit remote form (`form()` from `$app/server`), for
// component tests.
//
// A component test cannot load a `*.remote.ts` module: SvelteKit turns it
// into calls to an endpoint that only a running app serves. The test mocks
// the module instead and hands the page these fakes, then puts each one in
// the state it wants to see rendered -- refused, saved, or holding what was
// typed -- the way it used to pass the page a `form` prop.
//
// ```ts
// vi.mock('./regions.remote', async () => {
//   const {fakeRemoteForm} = await import('.../fake-remote-form');
//   return {createRegion: fakeRemoteForm(), updateRegion: fakeRemoteForm()};
// });
// ```

/** An issue, as a remote form reports it. */
export interface FakeFormIssue {
  /** The control it belongs to; empty for the form as a whole. */
  path: Array<string | number>;
  message: string;
}

/** What a test can put a fake form into. */
export interface FakeFormState {
  /** What the form was refused with. */
  issues?: FakeFormIssue[];
  /** What the handler returned. */
  result?: unknown;
  /** What the form holds for each field, by the field's name. */
  values?: Record<string, string | boolean>;
}

/** A fake remote form, and the handles a test drives it with. */
export interface FakeRemoteForm {
  method: 'POST';
  action: string;
  readonly result: unknown;
  readonly fields: unknown;
  for(key: string): FakeRemoteForm;
  /** Puts the form in a state, replacing the one it was in. */
  setState(state: FakeFormState): void;
  /** Clears the form and every instance `for()` has handed out. */
  reset(): void;
}

/**
 * The attributes `field.as()` returns for one control.
 * @param name The field's name.
 * @param state The form's state.
 * @param type The input type asked for.
 * @param initial The value the control starts at.
 */
function controlProps(
  name: string,
  state: FakeFormState,
  type: string,
  initial: string | boolean | undefined,
): Record<string, unknown> {
  const invalid = state.issues?.some(issue => issue.path[0] === name)
    ? 'true'
    : undefined;
  const held = state.values?.[name];
  if (type === 'checkbox') {
    return {
      name: `b:${name}`,
      type,
      'aria-invalid': invalid,
      checked: held ?? initial ?? false,
    };
  }
  if (type === 'hidden') {
    return {name, type, value: initial};
  }
  return {
    name,
    ...(type === 'text' ? {} : {type}),
    'aria-invalid': invalid,
    value: held ?? initial ?? '',
    ...(initial === undefined ? {} : {defaultValue: initial}),
  };
}

/**
 * Builds a fake remote form.
 * @param action What the `<form>` posts to; only there to be told apart.
 */
export function fakeRemoteForm(action = '?/remote=fake'): FakeRemoteForm {
  let state: FakeFormState = {};
  const instances = new Map<string, FakeRemoteForm>();

  const fields = new Proxy(
    {},
    {
      get(_, name) {
        if (name === 'allIssues') {
          return () => (state.issues?.length ? state.issues : undefined);
        }
        if (typeof name !== 'string') return undefined;
        return {
          as: (type: string, initial?: string | boolean) =>
            controlProps(name, state, type, initial),
          issues: () => {
            const own = state.issues?.filter(issue => issue.path[0] === name);
            return own?.length ? own : undefined;
          },
          value: () => state.values?.[name],
        };
      },
    },
  );

  // Only `method` and `action` are enumerable, as on the real thing: the
  // page spreads the form onto a `<form>`, and everything enumerable becomes
  // an attribute.
  const form = {method: 'POST', action} as FakeRemoteForm;
  return Object.defineProperties(form, {
    fields: {value: fields},
    result: {get: () => state.result},
    for: {
      value: (key: string) => {
        let instance = instances.get(key);
        if (!instance) {
          instance = fakeRemoteForm(`${action}/${key}`);
          instances.set(key, instance);
        }
        return instance;
      },
    },
    setState: {
      value: (next: FakeFormState) => {
        state = next;
      },
    },
    reset: {
      value: () => {
        state = {};
        instances.clear();
      },
    },
  });
}
