// app/api/admin/customers/[customerId]/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  try {
    const { customerId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Get customer with comprehensive details
    const customer = await prisma.user.findUnique({
      where: { 
        id: customerId,
        role: 'CUSTOMER'
      },
      include: {
        orders: {
          where: { laundryId },
          include: {
            orderItems: {
              include: {
                product: {
                  select: {
                    name: true,
                    category: true
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        reviews: {
          where: { laundryId },
          orderBy: { createdAt: 'desc' }
        },
        addresses: {
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
          ]
        }
      }
    })

    if (!customer) {
      return errorResponse('Customer not found', 404)
    }

    // Verify customer has interacted with this laundry
    if (customer.orders.length === 0) {
      return errorResponse('Customer has no orders with this laundry', 404)
    }

    // Calculate customer statistics
    const totalOrders = customer.orders.length
    const totalSpent = customer.orders.reduce((sum, order) => sum + order.finalAmount, 0)
    const completedOrders = customer.orders.filter(order => 
      ['COMPLETED', 'DELIVERED'].includes(order.status)
    ).length
    
    const canceledOrders = customer.orders.filter(order => order.status === 'CANCELED').length
    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0
    
    // Calculate satisfaction metrics
    const averageRating = customer.reviews.length > 0 ? 
      customer.reviews.reduce((sum, review) => sum + review.rating, 0) / customer.reviews.length : 0
    
    const lastOrder = customer.orders[0]
    const firstOrder = customer.orders[customer.orders.length - 1]
    
    // Calculate customer lifetime (days since first order)
    const customerLifetimeDays = firstOrder ? 
      Math.floor((new Date().getTime() - firstOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : 0
    
    // Calculate order frequency (orders per month)
    const orderFrequency = customerLifetimeDays > 0 ? (totalOrders / (customerLifetimeDays / 30)) : 0

    // Determine customer segment
    let segment: string
    if (totalSpent >= 500 && totalOrders >= 5) {
      segment = 'VIP'
    } else if (totalSpent >= 200 && totalOrders >= 3) {
      segment = 'Premium'
    } else if (totalOrders >= 2) {
      segment = 'Regular'
    } else {
      segment = 'New'
    }

    // Get service preferences (most ordered categories)
    const servicePreferences = customer.orders.reduce((acc, order) => {
      order.orderItems.forEach(item => {
        const category = item.product.category || 'Other'
        if (!acc[category]) {
          acc[category] = { count: 0, totalSpent: 0 }
        }
        acc[category].count += item.quantity
        acc[category].totalSpent += item.totalPrice
      })
      return acc
    }, {} as Record<string, { count: number; totalSpent: number }>)

    const sortedPreferences = Object.entries(servicePreferences)
      .map(([category, data]) => ({
        category,
        orders: data.count,
        totalSpent: data.totalSpent,
        percentage: (data.totalSpent / totalSpent) * 100
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)

    // Calculate spending trend (last 6 months)
    const spendingTrend = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date()
      monthStart.setMonth(monthStart.getMonth() - i)
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthEnd.getMonth() + 1)
      monthEnd.setDate(0)
      monthEnd.setHours(23, 59, 59, 999)
      
      const monthOrders = customer.orders.filter(order => 
        order.createdAt >= monthStart && order.createdAt <= monthEnd
      )
      
      const monthSpending = monthOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      
      spendingTrend.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        spending: monthSpending,
        orders: monthOrders.length
      })
    }

    // Customer status based on recent activity
    const daysSinceLastOrder = lastOrder ? 
      Math.floor((new Date().getTime() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : null
    
    let status: string
    if (daysSinceLastOrder === null) {
      status = 'new'
    } else if (daysSinceLastOrder <= 30) {
      status = 'active'
    } else if (daysSinceLastOrder <= 90) {
      status = 'dormant'
    } else {
      status = 'inactive'
    }

    // Format order history for display
    const orderHistory = customer.orders.slice(0, 10).map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      totalAmount: order.finalAmount,
      itemCount: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
      services: Array.from(new Set(order.orderItems.map(item => item.product.category))),
      orderDate: order.createdAt,
      deliveryDate: order.deliveryDate
    }))

    const response = {
      // Basic customer info
      id: customer.id,
      name: customer.name || customer.email.split('@')[0],
      email: customer.email,
      phone: customer.phone,
      avatar: customer.avatar,
      memberSince: customer.createdAt,
      segment,
      status,
      
      // Statistics
      stats: {
        totalOrders,
        completedOrders,
        canceledOrders,
        totalSpent,
        averageOrderValue,
        orderFrequency: Math.round(orderFrequency * 100) / 100,
        customerLifetimeDays,
        averageRating: Math.round(averageRating * 10) / 10,
        totalReviews: customer.reviews.length
      },
      
      // Last order info
      lastOrder: lastOrder ? {
        id: lastOrder.id,
        orderNumber: lastOrder.orderNumber,
        amount: lastOrder.finalAmount,
        date: lastOrder.createdAt,
        status: lastOrder.status,
        daysSince: daysSinceLastOrder
      } : null,
      
      // Service preferences
      preferences: {
        favoriteServices: sortedPreferences.slice(0, 5),
        spendingDistribution: sortedPreferences
      },
      
      // Trends
      trends: {
        spendingTrend,
        orderFrequencyTrend: spendingTrend.map(month => ({
          month: month.month,
          orders: month.orders
        }))
      },
      
      // Contact information
      addresses: customer.addresses.map(address => ({
        id: address.id,
        street: address.street,
        city: address.city,
        state: address.state,
        zipCode: address.zipCode,
        isDefault: address.isDefault
      })),
      
      // Recent order history
      recentOrders: orderHistory,
      
      // Reviews
      recentReviews: customer.reviews.slice(0, 5).map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt
      }))
    }

    return successResponse(response, 'Customer details retrieved successfully')
  } catch (error: any) {
    console.error('Get customer details error:', error)
    return errorResponse('Failed to retrieve customer details', 500)
  }
}

// DELETE /api/admin/customers/[customerId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: { customerId: string } }
) {
  try {
    const { customerId } = params
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Check if customer exists
    const customer = await prisma.user.findUnique({
      where: { 
        id: customerId,
        role: 'CUSTOMER'
      },
      include: {
        orders: {
          where: { 
            laundryId,
            status: {
              in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
            }
          }
        }
      }
    })

    if (!customer) {
      return errorResponse('Customer not found', 404)
    }

    // Check if customer has active orders
    if (customer.orders.length > 0) {
      return errorResponse('Cannot delete customer with active orders. Please complete or cancel active orders first.', 400)
    }

    // OPTION 1: Soft delete - Keep customer but mark as deleted
    // This preserves order history and referential integrity
    const updatedCustomer = await prisma.user.update({
      where: { id: customerId },
      data: {
        name: `${customer.name || 'Customer'} (Deleted)`,
        email: `deleted_${Date.now()}_${customer.email}`, // Prevent email conflicts
        phone: null // Clear personal data
      }
    })

    // Create activity log
    try {
      await prisma.activity.create({
        data: {
          type: 'ORDER_CANCELED' as any, // Using existing type
          title: 'Customer account deleted',
          description: `Customer account for ${customer.name || customer.email} was deleted`,
          laundryId,
          userId: customerId,
          metadata: {
            deletedBy: 'admin',
            originalEmail: customer.email,
            originalName: customer.name,
            action: 'CUSTOMER_DELETED'
          }
        }
      })
    } catch (activityError) {
      console.error('Activity logging failed:', activityError)
    }

    return successResponse(
      { 
        customerId, 
        deleted: true, 
        method: 'soft_delete',
        message: 'Customer account marked as deleted while preserving order history'
      }, 
      'Customer deleted successfully'
    )

    // OPTION 2: Hard delete (uncomment if you want complete removal)
    // WARNING: This will break referential integrity if customer has orders
    /*
    await prisma.user.delete({
      where: { id: customerId }
    })

    return successResponse(
      { customerId, deleted: true, method: 'hard_delete' }, 
      'Customer permanently deleted'
    )
    */

  } catch (error: any) {
    console.error('Delete customer error:', error)
    
    // Handle foreign key constraint errors
    if (error?.code === 'P2003') {
      return errorResponse('Cannot delete customer due to existing references (orders, reviews, etc.). Use soft delete instead.', 400)
    }
    
    return errorResponse('Failed to delete customer', 500)
  }
}