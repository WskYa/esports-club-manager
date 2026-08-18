import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'

const routes = [
  { path: '/auth', name: 'auth', component: () => import('./views/AuthView.vue'), meta: { public: true } },
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/teams', name: 'teams', component: () => import('./views/TeamsView.vue') },
  { path: '/tournaments', name: 'tournaments', component: () => import('./views/TournamentsView.vue') },
  { path: '/activities', name: 'activities', component: () => import('./views/ActivitiesView.vue') },
  { path: '/notifications', name: 'notifications', component: () => import('./views/NotificationsView.vue') },
  { path: '/profile', name: 'profile', component: () => import('./views/ProfileView.vue') },
  { path: '/admin', name: 'admin', component: () => import('./views/AdminView.vue'), meta: { admin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({ history: createWebHistory(), routes })

router.beforeEach(async (to) => {
  const store = useAuthStore()
  if (!store.ready) await store.init()
  if (to.meta.public) return true
  if (!store.isLoggedIn && !store.guest) return { name: 'auth' }
  if (to.meta.admin && !store.isAdmin) return { name: 'home' }
  return true
})

export default router
