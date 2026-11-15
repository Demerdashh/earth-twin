import type { DataSource } from '../config/data-source';
import type { ContractError } from '../data/validate';
import { clear, h } from './dom';

export function renderFatal(root: HTMLElement, title: string, message: string): void {
  clear(root);
  root.append(
    h(
      'div',
      { class: 'fatal', role: 'alert' },
      h('h1', {}, title),
      h('p', {}, message),
      h('p', {}, h('a', { class: 'btn btn-primary', href: location.href }, 'Reload')),
    ),
  );
}

/** Full-screen, explicit error when data does not match the contract. Nothing invalid is rendered. */
export function renderContractErrors(root: HTMLElement, source: DataSource, errors: ContractError[]): void {
  clear(root);
  const url = new URL(location.href);
  url.searchParams.set('data', 'mock');
  root.append(
    h(
      'div',
      { class: 'fatal', role: 'alert' },
      h('p', { class: 'kicker' }, 'Data contract check failed'),
      h('h1', {}, `The ${source} data does not match the contract`),
      h(
        'p',
        {},
        `The app refuses to show it. ${errors.length} problem(s) found — fix them in the producing pipeline and validate with `,
        h('code', {}, `npm run validate:data -- public/${source === 'mock' ? 'data/mock' : 'data'}`),
        '.',
      ),
      h(
        'ol',
        { class: 'error-list' },
        ...errors
          .slice(0, 200)
          .map((e) => h('li', {}, h('code', {}, e.file), ' ', h('code', { class: 'muted' }, e.path), ' — ', e.message)),
      ),
      source === 'real'
        ? h('p', {}, h('a', { class: 'btn btn-primary', href: url.toString() }, 'Load the mock data set instead'))
        : null,
    ),
  );
}
