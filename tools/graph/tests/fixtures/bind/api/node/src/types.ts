// An order as the Node service writes it.
export interface OrderView {
  customerId: string
  orderId: string
  status: 'OPEN' | 'PAID' | 'ON_HOLD'
  total: number
  note?: string | null
  lines: { sku: string; qty: number }[]
}
