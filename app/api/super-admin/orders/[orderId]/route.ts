import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// GET /api/admin/orders/[orderId]
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            createdAt: true,
            addresses: {
              select: {
                id: true,
                street: true,
                city: true,
                state: true,
                zipCode: true,
                isDefault: true
              }
            }
          }
        },
        laundry: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            logo: true,
            status: true,
            rating: true,
            addresses: {
              select: {
                street: true,
                city: true,
                state: true,
                zipCode: true
              },
              take: 1
            },
            admin: {
              select: {
                name: true,
                email: true,
                phone: true
              }
            }
          }
        },
        address: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            latitude: true,
            longitude: true
          }
        },
        orderItems: {
          select: {
            id: true,
            quantity: true,
            price: true,
            totalPrice: true,
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                category: true,
                unit: true
              }
            }
          }
        },
        activities: {
          select: {
            id: true,
            type: true,
            title: true,
            description: true,
            metadata: true,
            createdAt: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    })

    if (!order) {
      return errorResponse('Order not found', 404)
    }

    // Get customer's order history count
    const customerOrderCount = await prisma.order.count({
      where: { customerId: order.customerId }
    })

    // Get customer's total spent
    const customerTotalSpent = await prisma.order.aggregate({
      where: {
        customerId: order.customerId,
        status: { in: ['COMPLETED', 'DELIVERED'] }
      },
      _sum: { finalAmount: true }
    })

    // Calculate order timeline/status history
    const statusTimeline = order.activities
      .filter(activity => activity.type.includes('ORDER'))
      .map(activity => ({
        status: activity.type.replace('ORDER_', ''),
        timestamp: activity.createdAt,
        description: activity.description
      }))

    // Format the comprehensive order details
    const orderDetails = {
      // Basic Order Information
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      
      // Financial Information
      pricing: {
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        finalAmount: order.finalAmount
      },
      
      // Customer Information
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        avatar: order.customer.avatar,
        memberSince: order.customer.createdAt,
        stats: {
          totalOrders: customerOrderCount,
          totalSpent: customerTotalSpent._sum.finalAmount || 0
        },
        addresses: order.customer.addresses
      },
      
      // Laundry Information
      laundry: {
        id: order.laundry.id,
        name: order.laundry.name,
        email: order.laundry.email,
        phone: order.laundry.phone,
        logo: order.laundry.logo,
        status: order.laundry.status,
        rating: order.laundry.rating,
        location: order.laundry.addresses[0] ? {
          street: order.laundry.addresses[0].street,
          city: order.laundry.addresses[0].city,
          state: order.laundry.addresses[0].state,
          zipCode: order.laundry.addresses[0].zipCode
        } : null,
        admin: order.laundry.admin
      },
      
      // Delivery Address
      deliveryAddress: {
        id: order.address.id,
        street: order.address.street,
        city: order.address.city,
        state: order.address.state,
        zipCode: order.address.zipCode,
        coordinates: {
          latitude: order.address.latitude,
          longitude: order.address.longitude
        }
      },
      
      // Order Items
      items: order.orderItems.map(item => ({
        id: item.id,
        product: {
          id: item.product.id,
          name: item.product.name,
          description: item.product.description,
          category: item.product.category,
          unit: item.product.unit
        },
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice: item.totalPrice
      })),
      
      // Order Summary
      summary: {
        totalItems: order.orderItems.length,
        totalQuantity: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        categories: Array.from(new Set(order.orderItems.map(item => item.product.category)))
      },
      
      // Important Dates
      dates: {
        orderDate: order.createdAt,
        pickupDate: order.pickupDate,
        deliveryDate: order.deliveryDate,
        lastUpdated: order.updatedAt
      },
      
      // Status Timeline
      timeline: statusTimeline,
      
      // Order Notes
      notes: order.notes,
      
      // Activity History
      activityHistory: order.activities.map(activity => ({
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        metadata: activity.metadata,
        timestamp: activity.createdAt
      }))
    }

    return successResponse(orderDetails, 'Order details retrieved successfully')
  } catch (error) {
    console.error('Order details error:', error)
    return errorResponse('Failed to retrieve order details', 500)
  }
}