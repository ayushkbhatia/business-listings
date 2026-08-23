/**
 * Arabic has six plural categories. English has two. Building the shape for six
 * now is the difference between a translation project and a rebuild.
 */
export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type Message = string | PluralForms;

export type Catalogue = Record<string, Message>;

export type Params = Record<string, string | number>;
