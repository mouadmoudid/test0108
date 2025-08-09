// app/api/admin/dashboard/recent-orders/route.ts - ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRole, successResponse, errorResponse } from '@/lib/auth-middleware'
import { z } from 'zod'

const recentOrdersQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(20).optional().default(5)
})

export async function GET(request: NextRequest) {
  const authResult = await requireRole(request, ['ADMIN'], { requireLaundry: true })
  
  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { user } = authResult

  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const parsed = recentOrdersQuerySchema.safeParse(queryParams)
    if (!parsed.success) {
      return errorResponse('Invalid query parameters')
    }

    const { limit } = parsed.data

    const recentOrders = await prisma.order.findMany({
      where: {
        laundryId: user.laundryId
      },
      include: {
        customer: {
          select: {
            name: true,
            avatar: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true
              }
            }
          },
          take: 3 // Limiter à 3 produits pour l'affichage
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    })

    const formattedOrders = recentOrders.map(order => {
      const primaryService = order.orderItems[0]?.product.category || 'Service général'
      const totalItems = order.orderItems.reduce((sum: number, item: any) => sum + item.quantity, 0)
      
      // Calculer le temps écoulé
      const hoursAgo = Math.floor((new Date().getTime() - order.createdAt.getTime()) / (1000 * 60 * 60))
      const timeAgo = hoursAgo < 24 
        ? `${hoursAgo}h` 
        : `${Math.floor(hoursAgo / 24)}j`

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customer: {
          name: order.customer.name,
          avatar: order.customer.avatar
        },
        service: {
          primary: primaryService,
          totalItems,
          description: order.orderItems.length > 1 
            ? `${primaryService} +${order.orderItems.length - 1} autres`
            : primaryService
        },
        amount: order.finalAmount,
        timeAgo,
        createdAt: order.createdAt,
        priority: ['PENDING'].includes(order.status) ? 'high' : 'normal'
      }
    })

    return successResponse({
      orders: formattedOrders,
      count: formattedOrders.length
    }, 'Recent orders retrieved successfully')
  } catch (error) {
    console.error('Recent orders error:', error)
    return errorResponse('Failed to retrieve recent orders', 500)
  }
}