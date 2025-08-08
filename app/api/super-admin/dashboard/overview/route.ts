// import { prisma } from '@/lib/prisma'
// import { successResponse, errorResponse } from '@/lib/response'

// export async function GET() {
//   try {
//     // Get current date and start of month for calculations
//     const now = new Date()
//     const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

//     // Parallel queries for better performance
//     const [
//       totalLaundries,
//       totalUsers,
//       totalOrders,
//       monthlyOrders,
//       totalRevenue,
//       monthlyRevenue,
//       activeLaundries,
//       pendingOrders,
//       completedOrders
//     ] = await Promise.all([
//       // Total laundries
//       prisma.laundry.count(),
      
//       // Total users (customers)
//       prisma.user.count({
//         where: { role: 'CUSTOMER' }
//       }),
      
//       // Total orders
//       prisma.order.count(),
      
//       // Monthly orders
//       prisma.order.count({
//         where: {
//           createdAt: {
//             gte: startOfMonth
//           }
//         }
//       }),
      
//       // Total revenue
//       prisma.order.aggregate({
//         _sum: {
//           finalAmount: true
//         },
//         where: {
//           status: {
//             in: ['COMPLETED', 'DELIVERED']
//           }
//         }
//       }),
      
//       // Monthly revenue
//       prisma.order.aggregate({
//         _sum: {
//           finalAmount: true
//         },
//         where: {
//           status: {
//             in: ['COMPLETED', 'DELIVERED']
//           },
//           createdAt: {
//             gte: startOfMonth
//           }
//         }
//       }),
      
//       // Active laundries
//       prisma.laundry.count({
//         where: { status: 'ACTIVE' }
//       }),
      
//       // Pending orders
//       prisma.order.count({
//         where: {
//           status: {
//             in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS']
//           }
//         }
//       }),
      
//       // Completed orders this month
//       prisma.order.count({
//         where: {
//           status: 'COMPLETED',
//           createdAt: {
//             gte: startOfMonth
//           }
//         }
//       })
//     ])

//     // Calculate growth percentages (simplified - you might want to compare with previous month)
//     const data = {
//       overview: {
//         totalLaundries,
//         totalUsers,
//         totalOrders,
//         platformRevenue: totalRevenue._sum.finalAmount || 0,
//       },
//       monthlyStats: {
//         monthlyOrders,
//         monthlyRevenue: monthlyRevenue._sum.finalAmount || 0,
//         completedOrders,
//       },
//       status: {
//         activeLaundries,
//         suspendedLaundries: totalLaundries - activeLaundries,
//         pendingOrders,
//       },
//       growth: {
//         ordersGrowth: 15.3, // This should be calculated based on previous period
//         revenueGrowth: 23.1, // This should be calculated based on previous period
//         userGrowth: 8.7, // This should be calculated based on previous period
//       }
//     }

//     return successResponse(data, 'Dashboard overview retrieved successfully')
//   } catch (error) {
//     console.error('Dashboard overview error:', error)
//     return errorResponse('Failed to retrieve dashboard overview', 500)
//   }
// }

// app/api/super-admin/dashboard/overview/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  // Vérifier que l'utilisateur est SUPER_ADMIN UNIQUEMENT
  const authResult = await requireRole(request, ['SUPER_ADMIN'])
  
  if (authResult instanceof NextResponse) {
    return authResult // Erreur d'authentification ou d'autorisation
  }

  const { user } = authResult

  // Vérifier que user.sub existe
  if (!user.sub) {
    return NextResponse.json(
      { success: false, message: 'Invalid user session' },
      { status: 401 }
    )
  }

  try {
    // Données globales de la plateforme pour le Super Admin
    const totalLaundries = await prisma.laundry.count()
    const totalUsers = await prisma.user.count()
    const totalOrders = await prisma.order.count()
    
    const totalRevenue = await prisma.order.aggregate({
      _sum: { finalAmount: true }
    })

    // Statistiques par statut de laundry
    const laundriesByStatus = await prisma.laundry.groupBy({
      by: ['status'],
      _count: { id: true }
    })

    // Top performing laundries
    const topLaundries = await prisma.laundry.findMany({
      select: {
        id: true,
        name: true,
        totalOrders: true,
        totalRevenue: true,
        rating: true,
        status: true
      },
      orderBy: { totalRevenue: 'desc' },
      take: 5
    })

    const overview = {
      platformMetrics: {
        totalLaundries,
        totalUsers,
        totalOrders,
        totalRevenue: totalRevenue._sum.finalAmount || 0
      },
      laundriesByStatus: laundriesByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id
        return acc
      }, {} as Record<string, number>),
      topPerformingLaundries: topLaundries,
      lastUpdated: new Date().toISOString()
    }

    return NextResponse.json({
      success: true,
      message: 'Super Admin dashboard data retrieved successfully',
      data: overview,
      requestedBy: {
        userId: user.sub,
        role: user.role,
        email: user.email
      }
    })

  } catch (error) {
    console.error('Super Admin dashboard overview error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}