import { z } from 'zod'

// Query parameter schemas
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
})

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

// Laundry performance query schema
export const laundryPerformanceQuerySchema = paginationSchema.merge(sortSchema).extend({
  sortBy: z.enum(['ordersMonth', 'customers', 'revenue', 'rating']).optional(),
})

// Order query schemas
export const orderQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELED', 'REFUNDED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// Review query schema
export const reviewQuerySchema = paginationSchema.extend({
  rating: z.coerce.number().min(1).max(5).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// Laundry update schema
export const laundryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().url().optional(),
  operatingHours: z.record(z.object({
    open: z.string(),
    close: z.string(),
    closed: z.boolean()
  })).optional(),
})

// Utility function to validate query parameters
export function validateQuery<T>(schema: z.ZodSchema<T>, query: any): T | null {
  try {
    return schema.parse(query)
  } catch (error) {
    return null
  }
}
// Additional schemas to add to lib/validations.ts

// Customer profile update schema
export const customerProfileUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number').optional(),
  avatar: z.string().url('Invalid avatar URL').optional(),
})

// Customer address schema
export const customerAddressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  country: z.string().default('Morocco'),
  isDefault: z.boolean().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
})

// Customer address update schema
export const customerAddressUpdateSchema = z.object({
  street: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  zipCode: z.string().min(1).optional(),
  country: z.string().optional(),
  isDefault: z.boolean().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
})

// Order creation schema
export const customerOrderCreateSchema = z.object({
  laundryId: z.string().cuid('Invalid laundry ID'),
  addressId: z.string().cuid('Invalid address ID'),
  items: z.array(z.object({
    productId: z.string().cuid('Invalid product ID'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1')
  })).min(1, 'At least one item is required'),
  pickupDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional(),
})

// Customer order query schema (for history)
export const customerOrderQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum([
    'PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 
    'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELED', 'REFUNDED'
  ]).optional(),
})

// Review creation schema (for future implementation)
export const customerReviewCreateSchema = z.object({
  orderId: z.string().cuid('Invalid order ID'),
  rating: z.coerce.number().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  comment: z.string().min(1, 'Comment is required').max(1000, 'Comment cannot exceed 1000 characters'),
})
