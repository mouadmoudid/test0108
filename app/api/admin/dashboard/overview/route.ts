// app/api/admin/dashboard/overview/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest,NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'


export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est ADMIN ou SUPER_ADMIN
  const authResult = await requireRole(request, ['ADMIN', 'SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification ou d'autorisation
  }

  const { user } = authResult
  try {
    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'week'
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculate date range based on timeframe
    const now = new Date()
    let startDate: Date
    
    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    // Get orders for the timeframe
    const ordersInPeriod = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate
        }
      },
      include: {
        orderItems: true
      }
    })

    // Calculate key metrics
    const totalOrders = ordersInPeriod.length
    const totalRevenue = ordersInPeriod.reduce((sum, order) => sum + order.finalAmount, 0)
    const completedOrders = ordersInPeriod.filter(order => 
      ['COMPLETED', 'DELIVERED'].includes(order.status)
    ).length
    
    const pendingOrders = ordersInPeriod.filter(order => 
      ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(order.status)
    ).length

    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Get all-time stats for comparison
    const allTimeStats = await prisma.order.aggregate({
      where: { laundryId },
      _sum: { finalAmount: true },
      _count: { id: true }
    })

    // Generate chart data for orders over time
    const ordersChartData = []
    const weeklyOrdersData = []
    
    if (timeframe === 'week') {
      // Daily data for week view
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
        const dayStart = new Date(date.setHours(0, 0, 0, 0))
        const dayEnd = new Date(date.setHours(23, 59, 59, 999))
        
        const dayOrders = ordersInPeriod.filter(order => 
          order.createdAt >= dayStart && order.createdAt <= dayEnd
        )
        
        ordersChartData.push({
          date: dayStart.toISOString().split('T')[0],
          orders: dayOrders.length,
          revenue: dayOrders.reduce((sum, order) => sum + order.finalAmount, 0)
        })
      }
    } else if (timeframe === 'month') {
      // Weekly data for month view
      for (let i = 3; i >= 0; i--) {
        const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000)
        const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
        
        const weekOrders = ordersInPeriod.filter(order => 
          order.createdAt >= weekStart && order.createdAt <= weekEnd
        )
        
        ordersChartData.push({
          date: `Week ${4 - i}`,
          orders: weekOrders.length,
          revenue: weekOrders.reduce((sum, order) => sum + order.finalAmount, 0)
        })
      }
    }

    // Weekly orders data (last 8 weeks)
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000)
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
      
      const weekOrders = await prisma.order.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: weekStart,
            lte: weekEnd
          }
        }
      })
      
      weeklyOrdersData.push({
        week: `W${8 - i}`,
        orders: weekOrders.length,
        revenue: weekOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      })
    }

    const response = {
      // Key metrics
      metrics: {
        totalOrders,
        totalRevenue,
        completedOrders,
        pendingOrders,
        averageOrderValue,
        allTimeOrders: allTimeStats._count.id || 0,
        allTimeRevenue: allTimeStats._sum.finalAmount || 0
      },
      
      // Chart data
      charts: {
        orders: ordersChartData,
        weeklyOrders: weeklyOrdersData
      },
      
      // Period info
      period: {
        timeframe,
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    }

    return successResponse(response, 'Dashboard overview retrieved successfully')
  } catch (error) {
    console.error('Dashboard overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )  }
}

