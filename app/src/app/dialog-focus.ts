import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Leva o foco para a janela quando ela abre (leitores de tela e teclado começam nela). */
@Directive({ selector: '[appDialogFocus]' })
export class DialogFocus {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    });
  }
}
