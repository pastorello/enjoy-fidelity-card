import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TabletColumns } from './TabletColumns';

// SPEC-tablet-kiosk, point 10: the two-column screens of the 1280×800 layout (keypad, summary,
// Card panel, "Nuovo premio") share one frame: the content on the left, a raised column of a
// fixed width on the right.

describe('TabletColumns', () => {
  it('puts the content on the left and a labelled column of the given width on the right', () => {
    render(
      <TabletColumns column="keypad" width={480} label="Tastierino" aside={<p>tasti</p>}>
        <p>importo</p>
      </TabletColumns>,
    );
    const layout = document.querySelector('[data-tablet="true"]');
    expect(layout).not.toBeNull();
    const aside = screen.getByRole('complementary', { name: 'Tastierino' });
    expect(aside).toHaveAttribute('data-tablet-column', 'keypad');
    expect(aside).toHaveAttribute('data-width', '480');
    expect(aside).toHaveTextContent('tasti');
    const main = document.querySelector('[data-tablet-column="main"]');
    expect(main).toHaveTextContent('importo');
    // The content comes first, as in reading order.
    expect(layout?.firstElementChild).toBe(main);
  });

  it('names the column by its heading', () => {
    render(
      <TabletColumns
        column="summary"
        width={400}
        labelledBy="riepilogo"
        aside={<h2 id="riepilogo">Riepilogo</h2>}
      >
        <p>catalogo</p>
      </TabletColumns>,
    );
    expect(screen.getByRole('complementary', { name: 'Riepilogo' })).toHaveAttribute(
      'data-width',
      '400',
    );
  });

  it('is a plain column, not a landmark, when what it holds names itself', () => {
    render(
      <TabletColumns column="card" width={440} aside={<section aria-label="Card">card</section>}>
        <p>form</p>
      </TabletColumns>,
    );
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.querySelector('[data-tablet-column="card"]')).toHaveAttribute(
      'data-width',
      '440',
    );
  });
});
