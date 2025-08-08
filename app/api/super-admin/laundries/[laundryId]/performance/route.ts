import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// GET /api/admin/laundries/[laundryId]/performance
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params

    // Check if laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get last 12 months data for charts
    const monthsData = []
    const currentDate = new Date()
    
    for (let i = 11; i >= 0; i--) {
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1)
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i + 1, 0)
      
      const [monthlyOrders, monthlyRevenue, uniqueCustomers] = await Promise.all([
        // Monthly orders
        prisma.order.count({
          where: {
            laundryId,
            createdAt: {
              gte: startDate,
              lte: endDate
            }
          }
        }),

        // Monthly revenue
        prisma.order.aggregate({
          where: {
            laundryId,
            status: { in: ['COMPLETED', 'DELIVERED'] },
            createdAt: {
              gte: startDate,
              lte: endDate
            }
          },
          _sum: { finalAmount: true }
        }),

        // Unique customers
        prisma.order.findMany({
          where: {
            laundryId,
            createdAt: {
              gte: startDate,
              lte: endDate
            }
          },
          select: { customerId: true },
          distinct: ['customerId']
        })
      ])

      monthsData.push({
        month: startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        year: startDate.getFullYear(),
        monthNumber: startDate.getMonth() + 1,
        orders: monthlyOrders,
        revenue: monthlyRevenue._sum.finalAmount || 0,
        customers: uniqueCustomers.length
      })
    }

    // Get order status distribution
    const orderStatusDistribution = await prisma.order.groupBy({
      by: ['status'],
      where: { laundryId },
      _count: { status: true }
    })

    // Get service popularity (top products)
    const servicePopularity = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: { laundryId }
      },
      _count: { productId: true },
      _sum: { quantity: true },
      orderBy: {
        _count: {
          productId: 'desc'
        }
      },
      take: 10
    })

    // Get product details for service popularity
    const productIds = servicePopularity.map(item => item.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, category: true }
    })

    const servicePopularityWithNames = servicePopularity.map(item => {
      const product = products.find(p => p.id === item.productId)
      return {
        productId: item.productId,
        productName: product?.name || 'Unknown',
        category: product?.category || 'Unknown',
        orderCount: item._count.productId,
        totalQuantity: item._sum.quantity || 0
      }
    })

    // Calculate performance metrics
    const currentMonth = monthsData[monthsData.length - 1] || { orders: 0, revenue: 0, customers: 0 }
    const previousMonth = monthsData[monthsData.length - 2] || { orders: 0, revenue: 0, customers: 0 }

    const ordersGrowth = previousMonth.orders > 0 
      ? ((currentMonth.orders - previousMonth.orders) / previousMonth.orders) * 100 
      : 0

    const revenueGrowth = previousMonth.revenue > 0 
      ? ((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) * 100 
      : 0

    const customerGrowth = previousMonth.customers > 0 
      ? ((currentMonth.customers - previousMonth.customers) / previousMonth.customers) * 100 
      : 0

    // Get peak hours data (simplified)
    const peakHours = await prisma.order.findMany({
      where: { laundryId },
      select: { createdAt: true }
    })

    const hourlyData = Array(24).fill(0)
    peakHours.forEach(order => {
      const hour = order.createdAt.getHours()
      hourlyData[hour]++
    })

    const peakHoursData = hourlyData.map((count, hour) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      orders: count
    }))

    const response = {
      laundryId,
      laundryName: laundry.name,
      performanceMetrics: {
        totalOrders: laundry.totalOrders,
        totalRevenue: laundry.totalRevenue,
        averageRating: laundry.rating,
        totalReviews: laundry.totalReviews,
        currentMonthOrders: currentMonth.orders,
        currentMonthRevenue: currentMonth.revenue,
        currentMonthCustomers: currentMonth.customers,
        growth: {
          orders: ordersGrowth,
          revenue: revenueGrowth,
          customers: customerGrowth
        }
      },
      chartData: {
        monthlyPerformance: monthsData,
        orderStatusDistribution: orderStatusDistribution.map(item => ({
          status: item.status,
          count: item._count.status
        })),
        servicePopularity: servicePopularityWithNames,
        peakHours: peakHoursData
      }
    }

    return successResponse(response, 'Laundry performance data retrieved successfully')
  } catch (error) {
    console.error('Laundry performance error:', error)
    return errorResponse('Failed to retrieve laundry performance data', 500)
  }
}