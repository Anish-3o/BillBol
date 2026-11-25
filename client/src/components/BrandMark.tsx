import { Icon } from './Icon';

// The BillBol logo tile. Its own file (not inside AppLayout) so the landing and login pages can
// use it without pulling the whole logged-in shell (Ramu panel, assistant) into their bundle.
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <Icon name="mic" size={size * 0.5} />
    </span>
  );
}
