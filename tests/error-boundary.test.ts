import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import NotFound, { metadata as notFoundMetadata } from '../app/not-found';
import RouteError from '../app/error';

function findButton(node: unknown): ReactElement<{ onClick?: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const button = findButton(child);
      if (button) return button;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === 'button') {
    return node as ReactElement<{ onClick?: () => void }>;
  }
  return findButton((node.props as { children?: unknown }).children);
}

test('404 page offers useful destinations and is excluded from indexing', () => {
  const html = renderToStaticMarkup(NotFound());

  assert.match(html, /الصفحة غير موجودة/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="\/news"/);
  const robots = notFoundMetadata.robots;
  assert.equal(typeof robots === 'object' && robots !== null ? robots.index : undefined, false);
});

test('route-level 500 fallback gives a safe message, a working retry, and a home link', () => {
  let retries = 0;
  const element = RouteError({
    error: new Error('private server detail'),
    reset: () => {
      retries += 1;
    },
  });
  const html = renderToStaticMarkup(element);

  assert.match(html, /حدث خطأ غير متوقع/);
  assert.match(html, /إعادة المحاولة/);
  assert.match(html, /href="\/"/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /private server detail/);

  const retryButton = findButton(element);
  assert.ok(retryButton, 'retry button should be present');
  retryButton.props.onClick?.();
  assert.equal(retries, 1);
});
