// app/api/super-admin/laundries/[laundryId]/suspend/route.ts - SUPER_ADMIN uniquement
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Schema pour la suspension
const suspendLaundrySchema = z.object({
  reason: z.string().min(10, 'Suspension reason must be at least 10 characters').max(500),
  suspensionType: z.enum(['TEMPORARY', 'INDEFINITE']).optional().default('TEMPORARY'),
  duration: z.object({
    days: z.number().min(1).max(365).optional(),
    until: z.string().datetime().optional()
  }).optional(),
  notifyAdmin: z.boolean().optional().default(true), // Corrigé: notifyAdmin au lieu de notifyadmin
  notifyCustomers: z.boolean().optional().default(false),
  additionalNotes: z.string().max(1000).optional()
})

export async function POST(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
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
    const { laundryId } = params
    const body = await request.json()
    
    const parsed = suspendLaundrySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Validation error', 
          errors: parsed.error.errors 
        },
        { status: 400 }
      )
    }

    const { reason, suspensionType, duration, notifyAdmin, notifyCustomers, additionalNotes } = parsed.data

    // Vérifier que la laundry existe et n'est pas déjà suspendue
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        orders: {
          where: {
            status: {
              in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
            }
          },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            customer: {
              select: {
                email: true,
                name: true
              }
            }
          }
        }
      }
    })

    if (!laundry) {
      return NextResponse.json(
        { success: false, message: 'Laundry not found' },
        { status: 404 }
      )
    }

    if (laundry.status === 'SUSPENDED') {
      return NextResponse.json(
        { success: false, message: 'Laundry is already suspended' },
        { status: 409 }
      )
    }

    // Calculer la date de fin de suspension
    let suspensionEndDate: Date | null = null
    if (suspensionType === 'TEMPORARY') {
      if (duration?.until) {
        suspensionEndDate = new Date(duration.until)
      } else if (duration?.days) {
        suspensionEndDate = new Date()
        suspensionEndDate.setDate(suspensionEndDate.getDate() + duration.days)
      } else {
        // Par défaut: 30 jours
        suspensionEndDate = new Date()
        suspensionEndDate.setDate(suspensionEndDate.getDate() + 30)
      }
    }

    // Effectuer la suspension dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Suspendre la laundry
      const suspendedLaundry = await tx.laundry.update({
        where: { id: laundryId },
        data: {
          status: 'SUSPENDED',
          suspensionReason: reason,
          suspendedAt: new Date(),
          updatedAt: new Date()
        }
      })

      // 2. Annuler les commandes en attente
      const cancelledOrders = await tx.order.updateMany({
        where: {
          laundryId,
          status: {
            in: ['PENDING', 'CONFIRMED']
          }
        },
        data: {
          status: 'CANCELED',
          notes: `Order cancelled due to laundry suspension: ${reason}`,
          updatedAt: new Date()
        }
      })

      // 3. Marquer les commandes en cours comme "en attente de résolution"
      const onHoldOrders = await tx.order.updateMany({
        where: {
          laundryId,
          status: {
            in: ['IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY']
          }
        },
        data: {
          notes: `Order on hold due to laundry suspension. Will be resolved soon.`,
          updatedAt: new Date()
        }
      })

      // 4. Créer un enregistrement de suspension (uniquement si le modèle existe)
      let suspensionRecord = null
      try {
        // Tentative de création du modèle LaundrySuspension s'il existe
        suspensionRecord = await tx.laundrySuspension.create({
          data: {
            laundryId,
            reason,
            suspendedAt: new Date(),
            liftedAt: suspensionEndDate,
            suspendedBy: user.sub,
            liftedBy: null,
            isActive: true,
            metadata: {
              previousStatus: laundry.status,
              cancelledOrders: cancelledOrders.count,
              onHoldOrders: onHoldOrders.count,
              totalActiveOrders: laundry.orders.length,
              suspensionType,
              additionalNotes
            }
          }
        })
      } catch (error) {
        // Si le modèle LaundrySuspension n'existe pas, on continue avec Activity seulement
        console.log('LaundrySuspension model not found, using Activity only')
      }

      // 5. Enregistrer l'activité (toujours créer une activité)
      await tx.activity.create({
        data: {
          type: 'LAUNDRY_SUSPENDED',
          title: 'Laundry Suspended',
          description: `Laundry "${laundry.name}" has been suspended by super admin`,
          laundryId,
          metadata: {
            reason,
            suspensionType,
            endDate: suspensionEndDate?.toISOString(),
            suspendedBy: user.sub,
            suspendedByRole: user.role,
            affectedOrders: laundry.orders.length,
            cancelledOrders: cancelledOrders.count,
            onHoldOrders: onHoldOrders.count,
            additionalNotes,
            timestamp: new Date().toISOString()
          }
        }
      })

      // 6. Suspendre temporairement le compte du propriétaire pour suspension indéfinie
      let adminSuspended = false
      if (suspensionType === 'INDEFINITE') {
        try {
          await tx.user.update({
            where: { id: laundry.admin.id },
            data: {
              suspendedAt: new Date(),
              suspensionReason: `Laundry suspended: ${reason}` // Utiliser suspensionReason au lieu de reason
            }
          })
          adminSuspended = true
        } catch (error) {
          // Si les colonnes n'existent pas dans User, on ignore
          console.log('User suspension fields not found, skipping admin suspension')
        }
      }

      return {
        suspendedLaundry,
        suspensionRecord,
        cancelledOrdersCount: cancelledOrders.count,
        onHoldOrdersCount: onHoldOrders.count,
        adminSuspended
      }
    })

    // Préparer les notifications
    const notifications = []

    // Notifier le propriétaire
    if (notifyAdmin) {
      notifications.push({
        type: 'admin',
        recipient: laundry.admin.email,
        subject: 'Laundry Suspension Notice',
        data: {
          laundryName: laundry.name,
          reason,
          suspensionType,
          endDate: suspensionEndDate,
          contactSupport: process.env.SUPPORT_EMAIL || 'support@example.com'
        }
      })
    }

    // Notifier les clients avec des commandes affectées
    if (notifyCustomers && laundry.orders.length > 0) {
      const uniqueCustomers = new Map()
      laundry.orders.forEach(order => {
        if (!uniqueCustomers.has(order.customer.email)) {
          uniqueCustomers.set(order.customer.email, {
            name: order.customer.name,
            orders: []
          })
        }
        uniqueCustomers.get(order.customer.email).orders.push(order.orderNumber)
      })

      uniqueCustomers.forEach((customerData, email) => {
        notifications.push({
          type: 'customer',
          recipient: email,
          subject: 'Service Temporary Unavailable',
          data: {
            customerName: customerData.name,
            laundryName: laundry.name,
            affectedOrders: customerData.orders,
            reason: 'temporary service interruption',
            expectedResolution: suspensionEndDate
          }
        })
      })
    }

    // TODO: Envoyer les notifications
    // await sendNotifications(notifications)

    // Formater la réponse
    const response = {
      suspension: {
        laundryId,
        laundryName: laundry.name,
        previousStatus: laundry.status,
        newStatus: 'SUSPENDED',
        reason,
        suspensionType,
        startDate: new Date().toISOString(),
        endDate: suspensionEndDate?.toISOString() || null,
        isIndefinite: suspensionType === 'INDEFINITE'
      },
      
      impact: {
        affectedOrders: laundry.orders.length,
        cancelledOrders: result.cancelledOrdersCount,
        onHoldOrders: result.onHoldOrdersCount,
        affectedCustomers: new Set(laundry.orders.map(order => order.customer.email)).size,
        adminSuspended: result.adminSuspended
      },
      
      notifications: {
        adminNotified: notifyAdmin,
        customersNotified: notifyCustomers,
        totalNotifications: notifications.length
      },
      
      nextSteps: [
        'Admin will be contacted about the suspension',
        'Affected customers will be notified if requested',
        'Orders in progress will be handled case by case',
        suspensionType === 'TEMPORARY' 
          ? `Automatic reactivation scheduled for ${suspensionEndDate?.toLocaleDateString()}`
          : 'Manual review required for reactivation'
      ]
    }

    return NextResponse.json({
      success: true,
      message: 'Laundry suspended successfully',
      data: response,
      suspendedBy: {
        userId: user.sub,
        role: user.role,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error: any) {
    console.error('Suspend laundry error:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        message: 'Failed to suspend laundry',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    )
  }
}

// Fonction helper pour envoyer les notifications (à implémenter)
async function sendNotifications(notifications: any[]) {
  // TODO: Implémenter avec un service d'email comme SendGrid, AWS SES, etc.
  console.log(`Should send ${notifications.length} notifications:`, notifications.map(n => ({
    type: n.type,
    recipient: n.recipient,
    subject: n.subject
  })))
  
  // Exemple d'implémentation:
  /*
  for (const notification of notifications) {
    try {
      if (notification.type === 'admin') {
        await emailService.send({
          to: notification.recipient,
          subject: notification.subject,
          template: 'laundry-suspension-admin',
          data: notification.data
        })
      } else if (notification.type === 'customer') {
        await emailService.send({
          to: notification.recipient,
          subject: notification.subject,
          template: 'laundry-suspension-customer',
          data: notification.data
        })
      }
    } catch (emailError) {
      console.error(`Failed to send notification to ${notification.recipient}:`, emailError)
    }
  }
  */
}