import { Component, ElementRef, input, OnChanges, SimpleChanges, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface StorefrontProduct {
  listing_id: string;
  product_code: string;
  title: string;
  price: string;
  currency: string;
  is_available: boolean;
  product_image_url: string | null;
}

interface StorefrontPage {
  tenant_slug: string;
  brand_name: string;
  storefront_heading: string;
  storefront_description: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  results: StorefrontProduct[];
  count: number;
  limit: number;
  offset: number;
}

interface CartLine { product: StorefrontProduct; quantity: number }

@Component({
  selector: 'app-ecommerce-storefront',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './storefront.html',
  styleUrl: './storefront.css',
})
export class EcommerceStorefront implements OnChanges {
  readonly tenantSlug = input.required<string>();
  readonly storefront = signal<StorefrontPage | null>(null);
  readonly products = signal<StorefrontProduct[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly selectedProduct = signal<StorefrontProduct | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly offset = signal(0);
  readonly count = signal(0);
  readonly pageSize = 24;
  query = '';
  @ViewChild('productDialog') private productDialog?: ElementRef<HTMLDialogElement>;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tenantSlug']) void this.load(true);
  }

  async search(): Promise<void> { await this.load(true); }

  async loadMore(): Promise<void> { await this.load(false); }

  private async load(reset: boolean): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    const slug = encodeURIComponent(this.tenantSlug());
    const nextOffset = reset ? 0 : this.offset();
    const params = new URLSearchParams({ limit: String(this.pageSize), offset: String(nextOffset) });
    if (this.query.trim()) params.set('q', this.query.trim());
    try {
      const response = await fetch(`/api/v1/storefronts/${slug}/?${params}`, { credentials: 'omit' });
      const data = await response.json() as StorefrontPage & { error?: { details?: string } };
      if (!response.ok) throw new Error(data.error?.details ?? (response.status === 404 ? '這個店面目前沒有開放。' : '暫時無法載入商品，請稍後再試。'));
      this.storefront.set(data);
      this.count.set(data.count);
      this.offset.set(nextOffset + data.results.length);
      this.products.update(current => reset ? data.results : [...current, ...data.results]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : '網路連線失敗，請稍後再試。');
      if (reset) { this.storefront.set(null); this.products.set([]); this.count.set(0); }
    } finally {
      this.loading.set(false);
    }
  }

  add(product: StorefrontProduct): void {
    if (!product.is_available) return;
    this.cart.update(lines => {
      const found = lines.find(line => line.product.listing_id === product.listing_id);
      return found
        ? lines.map(line => line.product.listing_id === product.listing_id ? { ...line, quantity: line.quantity + 1 } : line)
        : [...lines, { product, quantity: 1 }];
    });
  }

  openProduct(product: StorefrontProduct): void {
    this.selectedProduct.set(product);
    this.productDialog?.nativeElement.showModal();
  }

  closeProduct(): void { this.selectedProduct.set(null); }

  changeQuantity(line: CartLine, delta: number): void {
    this.cart.update(lines => lines
      .map(row => row.product.listing_id === line.product.listing_id ? { ...row, quantity: row.quantity + delta } : row)
      .filter(row => row.quantity > 0));
  }

  cartCount(): number { return this.cart().reduce((sum, line) => sum + line.quantity, 0); }

  subtotal(): number { return this.cart().reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0); }

  lineTotal(line: CartLine): string { return (Number(line.product.price) * line.quantity).toFixed(2); }

  cartCurrency(): string | null {
    const currencies = [...new Set(this.cart().map(line => line.product.currency))];
    return currencies.length === 1 ? currencies[0] : null;
  }

  formatPrice(value: string, currency: string): string {
    return new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
  }

  trackProduct(_index: number, product: StorefrontProduct): string { return product.listing_id; }
}
