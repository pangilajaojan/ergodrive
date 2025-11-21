import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard'; // Path diperbaiki

const routes: Routes = [
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full',
  },
  {
    path: 'welcome',
    loadChildren: () =>
      import('./welcome/welcome.module').then((m) => m.WelcomePageModule), // Path diperbaiki
  },
  {
    path: 'login',
    loadChildren: () =>
      import('./login/login.module').then((m) => m.LoginPageModule), // Path diperbaiki
  },
  {
    path: 'register',
    loadChildren: () =>
      import('./register/register.module').then((m) => m.RegisterPageModule),
  },
  {
    path: 'home',
    loadChildren: () =>
      import('./home/home.module').then((m) => m.HomePageModule),
    canActivate: [authGuard],
  },
  {
    path: 'beban-kerja',
    loadChildren: () =>
      import('./beban-kerja/beban-kerja.module').then(
        (m) => m.BebanKerjaPageModule
      ),
    canActivate: [authGuard],
  },
  {
    path: 'tingkat-kantuk',
    loadChildren: () =>
      import('./tingkat-kantuk/tingkat-kantuk.module').then(
        (m) => m.TingkatKantukPageModule
      ),
    canActivate: [authGuard],
  },
  {
    path: 'waktu-reaksi',
    loadChildren: () =>
      import('./waktu-reaksi/waktu-reaksi.module').then(
        (m) => m.WaktuReaksiPageModule
      ),
    canActivate: [authGuard],
  },
  {
    path: 'waktu-reaksi/driving',
    loadComponent: () =>
      import('./waktu-reaksi/driving/driving.component').then(
        (m) => m.DrivingComponent
      ),
    canActivate: [authGuard],
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
