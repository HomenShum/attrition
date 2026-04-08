//! nodebench-qa-core: Core types, configuration, and error handling
//!
//! This crate provides the foundational types shared across all nodebench-qa crates.
//! It is the dependency root — no other nodebench-qa crate depends on anything
//! except this one.

pub mod config;
pub mod error;
pub mod types;

pub use config::AppConfig;
pub use error::{Error, Result};
