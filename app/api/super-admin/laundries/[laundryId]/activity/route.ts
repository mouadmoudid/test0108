import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// GET /api/admin/laundries/[laundryId]/activity
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')

    // Check if laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get recent activities for this laundry
    const activities = await prisma.activity.findMany({
      where: {
        OR: [
          { laundryId: laundryId },
          { 
            order: { 
              laundryId: laundryId 
            } 
          }
        ]
      },
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        metadata: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
            role: true
          }
        },
        order: {
          select: {
            orderNumber: true,
            status: true,
            finalAmount: true,
            customer: {
              select: {
                name: true,
                email: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    })

    // Format activities with enhanced information
    const formattedActivities = activities.map(activity => {
      let enhancedActivity = {
        id: activity.id,
        type: activity.type,
        title: activity.title,
        description: activity.description,
        createdAt: activity.createdAt,
        metadata: activity.metadata,
        relatedUser: activity.user,
        relatedOrder: activity.order
      }

      // Add specific formatting based on activity type
      switch (activity.type) {
        case 'ORDER_CREATED':
          enhancedActivity.title = `New order received`
          enhancedActivity.description = activity.order 
            ? `Order ${activity.order.orderNumber} from ${activity.order.customer?.name || 'Customer'}`
            : activity.description
          break
        
        case 'ORDER_COMPLETED':
          enhancedActivity.title = `Order completed`
          enhancedActivity.description = activity.order 
            ? `Order ${activity.order.orderNumber} completed - $${activity.order.finalAmount}`
            : activity.description
          break
        
        case 'ORDER_CANCELED':
          enhancedActivity.title = `Order canceled`
          enhancedActivity.description = activity.order 
            ? `Order ${activity.order.orderNumber} was canceled`
            : activity.description
          break
        
        case 'REVIEW_ADDED':
          enhancedActivity.title = `New review received`
          break
        
        case 'LAUNDRY_SUSPENDED':
          enhancedActivity.title = `Laundry suspended`
          enhancedActivity.description = `This laundry has been suspended by admin`
          break
        
        case 'LAUNDRY_ACTIVATED':
          enhancedActivity.title = `Laundry activated`
          enhancedActivity.description = `This laundry has been activated`
          break
      }

      return enhancedActivity
    })

    // Group activities by date for better organization
    const groupedActivities = formattedActivities.reduce((groups: any, activity) => {
      const date = activity.createdAt.toDateString()
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(activity)
      return groups
    }, {})

    // Convert grouped activities to array format
    const activityGroups = Object.entries(groupedActivities).map(([date, activities]) => ({
      date,
      activities
    }))

    // Get activity summary statistics
    const activityStats = await prisma.activity.groupBy({
      by: ['type'],
      where: {
        OR: [
          { laundryId: laundryId },
          { 
            order: { 
              laundryId: laundryId 
            } 
          }
        ],
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      },
      _count: { type: true }
    })

    const response = {
      laundryId,
      laundryName: laundry.name,
      recentActivities: formattedActivities,
      groupedActivities: activityGroups,
      summary: {
        totalActivities: formattedActivities.length,
        last30DaysStats: activityStats.map(stat => ({
          type: stat.type,
          count: stat._count.type
        }))
      }
    }

    return successResponse(response, 'Laundry activity retrieved successfully')
  } catch (error) {
    console.error('Laundry activity error:', error)
    return errorResponse('Failed to retrieve laundry activity', 500)
  }
}