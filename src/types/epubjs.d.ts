declare module 'epubjs' {
  export interface Book {
    ready: Promise<void>;
    renderTo(element: HTMLElement, options?: any): Rendition;
    locations: {
      generate(chars?: number): Promise<void>;
      percentageFromCfi(cfi: string): number;
    };
    spine: {
      spineItems?: Array<any>;
      length?: number;
    };
  }

  export interface Rendition {
    display(target?: string): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    on(event: string, callback: Function): void;
    hooks: {
      content: {
        register(callback: Function): void;
      };
    };
    destroy(): void;
  }

  export interface Location {
    start: {
      cfi: string;
      index: number;
    };
    atStart?: boolean;
    atEnd?: boolean;
  }

  function ePub(url: string, options?: any): Book;
  export default ePub;
}
