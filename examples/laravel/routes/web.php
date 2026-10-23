<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('welcome'));
Route::get('/listing/{id}', fn (string $id) => view('listing', ['id' => $id]));
